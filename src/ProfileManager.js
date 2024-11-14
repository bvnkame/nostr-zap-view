import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName, verifyNip05 } from "./utils.js";
import { PROFILE_CONFIG } from "./ZapConfig.js";

/**
 * @typedef {Object} ProfileResult
 * @property {string} name
 * @property {string} display_name
 * @property {string} [picture]
 * @property {string} [about]
 */

/**
 * Nostrのプロフィール情報を管理するクラス
 * Singletonパターンを採用し、アプリケーション全体で1つのインスタンスを共有
 */
export class ProfileManager {
  static #instance = null;

  static getInstance() {
    if (!ProfileManager.#instance) {
      ProfileManager.#instance = new ProfileManager();
    }
    return ProfileManager.#instance;
  }

  /**
   * プロフィール情報の取得に関する設定
   * - BATCH_SIZE: 一度に取得するプロフィールの数
   * - BATCH_DELAY: バッチ処理間の待機時間（ミリ秒）
   * - RELAYS: プロフィール情報を取得するリレーサーバーのリスト
   */
  #config = PROFILE_CONFIG;

  constructor() {
    if (ProfileManager.#instance) {
      throw new Error("Use ProfileManager.getInstance()");
    }
    this.#initialize();
    this.nip05Cache = new Map();
    this.pendingFetches = new Map(); // 進行中のフェッチを追跡
    this.nip05PendingFetches = new Map(); // 追加
  }

  /**
   * 初期化処理を行う
   * キャッシュやキューなどの内部状態を初期化
   */
  #initialize() {
    this.profileCache = new Map();
    this.profileFetchPromises = new Map();
    this.batchQueue = new Set();
    this.resolvers = new Map();
    this.fetchingPubkeys = new Set(); // フェッチ中のpubkeyを管理
    this.batchTimer = null;
  }

  /**
   * 複数の公開鍵に対応するプロフィール情報を一括取得
   * @param {string[]} pubkeys - 取得対象の公開鍵の配列
   * @returns {Promise<ProfileResult[]>} プロフィール情報の配列
   */
  async fetchProfiles(pubkeys) {
    // キャッシュ済みのpubkeyを除外
    const uncachedPubkeys = pubkeys.filter((key) => !this.profileCache.has(key));

    if (uncachedPubkeys.length === 0) {
      // 全てキャッシュ済みの場合は即座に結果を返す
      return pubkeys.map((pubkey) => this.profileCache.get(pubkey) || this._createDefaultProfile());
    }

    // 未キャッシュのpubkeysに対して一括フェッチをスケジュール
    const fetchPromises = uncachedPubkeys.map((pubkey) => {
      // 既に進行中のフェッチがある場合はそれを返す
      if (this.pendingFetches.has(pubkey)) {
        return this.pendingFetches.get(pubkey);
      }

      // 新しいフェッチPromiseを作成
      const promise = new Promise((resolve) => {
        this.resolvers.set(pubkey, resolve);
      });
      this.pendingFetches.set(pubkey, promise);
      this.batchQueue.add(pubkey);

      return promise;
    });

    // バッチ処理をスケジュール
    this._scheduleBatchProcess();

    // 全てのフェッチが完了するのを待つ
    await Promise.all(fetchPromises);

    // キャッシュから結果を返す
    return pubkeys.map((pubkey) => this.profileCache.get(pubkey) || this._createDefaultProfile());
  }

  /**
   * 公開鍵に対するプロフィール取得のPromiseを管理
   * 同一の公開鍵に対する重複リクエストを防ぐ
   */
  async _getOrCreateFetchPromise(pubkey) {
    if (this.profileFetchPromises.has(pubkey)) {
      return this.profileFetchPromises.get(pubkey);
    }

    const promise = new Promise((resolve) => {
      this.resolvers.set(pubkey, resolve);
    });

    this.profileFetchPromises.set(pubkey, promise);
    this.batchQueue.add(pubkey);

    this._scheduleBatchProcess();
    return promise;
  }

  /**
   * バッチ処理のスケジューリング
   * 連続的なリクエストを1つのバッチにまとめる
   */
  _scheduleBatchProcess() {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this._processBatchQueue();
    }, this.#config.BATCH_DELAY);
  }

  async _batchFetch(pubkeys) {
    pubkeys.forEach((key) => this.batchQueue.add(key));
    return new Promise((resolve) => {
      this.batchTimer = setTimeout(async () => {
        await this._processBatchQueue();
        resolve();
      }, this.#config.BATCH_DELAY);
    });
  }

  /**
   * プロフィール情報の一括取得処理
   * バッチサイズに応じて複数回に分けて処理
   */
  async _processBatchQueue() {
    if (this.batchQueue.size === 0) return;

    // フェッチ中でないpubkeyのみを対象にする
    const availablePubkeys = Array.from(this.batchQueue).filter((key) => !this.fetchingPubkeys.has(key));

    if (availablePubkeys.length === 0) return;

    const batchPubkeys = availablePubkeys.slice(0, this.#config.BATCH_SIZE);
    this.batchQueue = new Set(Array.from(this.batchQueue).filter((key) => !batchPubkeys.includes(key)));

    // フェッチ開始前にフェッチ中として記録
    batchPubkeys.forEach((key) => this.fetchingPubkeys.add(key));

    try {
      await this._fetchProfileFromRelay(batchPubkeys);
    } finally {
      // フェッチ完了後にフェッチ中リストから削除
      batchPubkeys.forEach((key) => {
        this.fetchingPubkeys.delete(key);
        this.pendingFetches.delete(key);
      });

      // キューに残りがある場合は次のバッチを処理
      if (this.batchQueue.size > 0) {
        this._scheduleBatchProcess();
      }
    }
  }

  /**
   * リレーからプロフィール情報を取得
   * 取得したプロフィールの処理とキャッシュへの保存を行う
   */
  async _fetchProfileFromRelay(pubkeys) {
    try {
      const profiles = await profilePool.querySync(this.#config.RELAYS, {
        kinds: [0],
        authors: pubkeys,
      });

      console.log("Debug: Fetched kind: 0 events:", profiles);

      await this._processProfiles(profiles);

      // プロフィールが取得できなかったpubkeyに対してnullを設定
      pubkeys.forEach((pubkey) => {
        if (!this.profileCache.has(pubkey)) {
          this.profileCache.set(pubkey, null);
          this._resolvePromise(pubkey, null);
        }
      });
    } catch (error) {
      console.error("プロフィールの取得に失敗:", error);
      this._handleFetchError(pubkeys);
    } finally {
      this._cleanupPromises(pubkeys);
    }
  }

  /**
   * 取得したプロフィール情報の処理
   * JSON解析とNIP-05の検証を行う
   */
  async _processProfiles(profiles) {
    await Promise.all(
      profiles.map(async (profile) => {
        try {
          const parsedContent = JSON.parse(profile.content);
          let parsedProfile = {
            ...parsedContent,
            name: getProfileDisplayName(parsedContent),
          };

          if (!parsedProfile.name) {
            parsedProfile.name = "nameless";
          }

          this.profileCache.set(profile.pubkey, parsedProfile);
          this._resolvePromise(profile.pubkey, parsedProfile);
        } catch (error) {
          console.error(`プロフィールのパース失敗: ${profile.pubkey}`, error);
          this._resolvePromise(profile.pubkey, this._createDefaultProfile());
        }
      })
    );
  }

  async verifyNip05Async(pubkey) {
    if (this.nip05Cache.has(pubkey)) {
      return this.nip05Cache.get(pubkey);
    }

    if (this.nip05PendingFetches.has(pubkey)) {
      return this.nip05PendingFetches.get(pubkey);
    }

    const fetchPromise = (async () => {
      const NIP05_TIMEOUT = 5000; // 5秒タイムアウト

      try {
        const profile = this.profileCache.get(pubkey);
        if (!profile?.nip05) return null;

        const nip05 = await Promise.race([
          verifyNip05(profile.nip05, pubkey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('NIP-05 verification timeout')), NIP05_TIMEOUT))
        ]);

        if (nip05) {
          this.nip05Cache.set(pubkey, nip05.startsWith("_@") ? nip05.slice(1) : nip05);
          return this.nip05Cache.get(pubkey);
        }
      } catch (error) {
        console.debug('NIP-05検証失敗またはタイムアウト:', error);
      } finally {
        this.nip05PendingFetches.delete(pubkey);
      }
      return null;
    })();

    this.nip05PendingFetches.set(pubkey, fetchPromise);
    return fetchPromise;
  }

  /**
   * デフォルトのプロフィール情報を生成
   * プロフィール取得に失敗した場合のフォールバック
   */
  _createDefaultProfile() {
    console.log("Debug: Creating default profile with name 'anonymous'");
    return {
      name: "anonymous",
      display_name: "anonymous",
    };
  }

  /**
   * プロフィール取得エラー時の処理
   * デフォルトプロフィールをキャッシュに設定
   */
  _handleFetchError(pubkeys) {
    pubkeys.forEach((pubkey) => {
      const defaultProfile = this._createDefaultProfile();
      console.log("Debug: Fetch error for pubkey:", pubkey, "Setting default profile:", defaultProfile);
      this.profileCache.set(pubkey, defaultProfile);
      this._resolvePromise(pubkey, defaultProfile);
    });
  }

  _resolvePromise(pubkey, profile) {
    const resolver = this.resolvers.get(pubkey);
    if (resolver) {
      resolver(profile);
      this.resolvers.delete(pubkey);
    }
  }

  _cleanupPromises(pubkeys) {
    pubkeys.forEach((key) => {
      this.resolvers.delete(key);
    });
  }

  /**
   * NIP-05アドレスの取得
   * キャッシュされた検証済みNIP-05アドレスを返却
   * @param {string} pubkey - 公開鍵
   * @returns {string|null} 検証済みNIP-05アドレス
   */
  getNip05(pubkey) {
    const nip05 = this.nip05Cache.get(pubkey);
    if (!nip05) return null;

    // _@で始まる場合は_を削除
    return nip05.startsWith("_@") ? nip05.slice(1) : nip05;
  }

  /**
   * キャッシュのクリア
   * プロフィール情報とNIP-05情報のキャッシュをクリア
   */
  clearCache() {
    this.profileCache.clear();
    this.profileFetchPromises.clear();
    this.resolvers.clear();
    this.nip05Cache.clear();
  }
}

export const profileManager = ProfileManager.getInstance();
