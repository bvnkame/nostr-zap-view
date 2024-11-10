import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName, verifyNip05 } from "./utils.js";

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
  #config = {
    BATCH_SIZE: 20,
    BATCH_DELAY: 100,
    RELAYS: ["wss://purplepag.es", "wss://directory.yabu.me", "wss://relay.nostr.band"],
  };

  constructor() {
    if (ProfileManager.#instance) {
      throw new Error("Use ProfileManager.getInstance()");
    }
    this.#initialize();
    this.nip05Cache = new Map();
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
  }

  /**
   * 単一の公開鍵に対応するプロフィール情報を取得
   * キャッシュに存在する場合はキャッシュから返却、存在しない場合は新規取得
   * @param {string} pubkey - 取得対象の公開鍵
   * @returns {Promise<ProfileResult>} プロフィール情報
   */
  async fetchProfile(pubkey) {
    console.log("単一プロフィール取得リクエスト:", pubkey);
    if (this.profileCache.has(pubkey)) {
      return this.profileCache.get(pubkey);
    }

    return this._getOrCreateFetchPromise(pubkey);
  }

  /**
   * 複数の公開鍵に対応するプロフィール情報を一括取得
   * @param {string[]} pubkeys - 取得対象の公開鍵の配列
   * @returns {Promise<ProfileResult[]>} プロフィール情報の配列
   */
  async fetchProfiles(pubkeys) {
    console.log("複数プロフィール取得リクエスト:", pubkeys);
    const uncachedPubkeys = pubkeys.filter((key) => !this.profileCache.has(key));

    if (uncachedPubkeys.length > 0) {
      await this._batchFetch(uncachedPubkeys);
    }

    return pubkeys.map((key) => this.profileCache.get(key) || this._createDefaultProfile());
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
    console.log("バッチ処理スケジュール");
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.batchTimer = setTimeout(() => this._processBatchQueue(), this.#config.BATCH_DELAY);
  }

  async _batchFetch(pubkeys) {
    console.log("バッチ取得:", pubkeys);
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
    console.log("バッチ処理開始:", this.batchQueue);
    if (this.batchQueue.size === 0) return;

    const batchPubkeys = Array.from(this.batchQueue).slice(0, this.#config.BATCH_SIZE);
    this.batchQueue = new Set(Array.from(this.batchQueue).slice(this.#config.BATCH_SIZE));

    await this._fetchProfileFromRelay(batchPubkeys);

    if (this.batchQueue.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#config.BATCH_DELAY));
      await this._processBatchQueue();
    }
  }

  /**
   * リレーからプロフィール情報を取得
   * 取得したプロフィールの処理とキャッシュへの保存を行う
   */
  async _fetchProfileFromRelay(pubkeys) {
    console.log("プロフィール取得リクエスト:", pubkeys);
    try {
      const profiles = await profilePool.querySync(this.#config.RELAYS, {
        kinds: [0],
        authors: pubkeys,
      });

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
        // 既に検証済みのNIP-05はスキップ
        if (this.nip05Cache.has(profile.pubkey)) {
          console.log("NIP-05キャッシュ済み:", profile.pubkey);
          return;
        }
        try {
          const parsedContent = JSON.parse(profile.content);
          const parsedProfile = {
            ...parsedContent,
            name: getProfileDisplayName(parsedContent),
          };

          // NIP-05の検証
          if (parsedContent.nip05) {
            const verifiedNip05 = await verifyNip05(parsedContent.nip05, profile.pubkey);
            if (verifiedNip05) {
              this.nip05Cache.set(profile.pubkey, verifiedNip05);
            }
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

  /**
   * デフォルトのプロフィール情報を生成
   * プロフィール取得に失敗した場合のフォールバック
   */
  _createDefaultProfile() {
    return {
      name: "Unknown",
      display_name: "Unknown",
    };
  }

  /**
   * プロフィール取得エラー時の処理
   * デフォルトプロフィールをキャッシュに設定
   */
  _handleFetchError(pubkeys) {
    pubkeys.forEach((pubkey) => {
      const defaultProfile = this._createDefaultProfile();
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
    pubkeys.forEach((key) => this.profileFetchPromises.delete(key));
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
