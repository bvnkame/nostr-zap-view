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
  static instance = null;

  constructor() {
    if (!ProfileManager.instance) {
      this._config = PROFILE_CONFIG;
      this._initialize();
      ProfileManager.instance = this;
    }
    return ProfileManager.instance;
  }

  _initialize() {
    // キャッシュやキューの初期化
    this.profileCache = new Map();
    this.nip05Cache = new Map();
    this.pendingFetches = new Map();
    this.nip05PendingFetches = new Map();
    this.fetchingPubkeys = new Set();
    this.batchQueue = new Set();
    this.resolvers = new Map();
    this.batchTimer = null;
  }

  async fetchProfiles(pubkeys) {
    // キャッシュされていない公開鍵をフィルタリング
    const uncachedPubkeys = pubkeys.filter(pubkey => !this.profileCache.has(pubkey));

    if (uncachedPubkeys.length === 0) {
      return pubkeys.map(pubkey => this.profileCache.get(pubkey) || this._createDefaultProfile());
    }

    // 未キャッシュの公開鍵に対してフェッチをスケジュール
    const fetchPromises = uncachedPubkeys.map(pubkey => this._getOrCreateFetchPromise(pubkey));

    // バッチ処理をスケジュール
    this._scheduleBatchProcess();

    // フェッチが完了するのを待機
    await Promise.all(fetchPromises);

    // 結果を返す
    return pubkeys.map(pubkey => this.profileCache.get(pubkey) || this._createDefaultProfile());
  }

  _getOrCreateFetchPromise(pubkey) {
    if (this.pendingFetches.has(pubkey)) {
      return this.pendingFetches.get(pubkey);
    }

    const promise = new Promise(resolve => {
      this.resolvers.set(pubkey, resolve);
    });
    this.pendingFetches.set(pubkey, promise);
    this.batchQueue.add(pubkey);
    return promise;
  }

  _scheduleBatchProcess() {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this._processBatchQueue();
    }, this._config.BATCH_DELAY);
  }

  async _processBatchQueue() {
    if (this.batchQueue.size === 0) return;

    const batchPubkeys = Array.from(this.batchQueue).splice(0, this._config.BATCH_SIZE);
    this.batchQueue = new Set(Array.from(this.batchQueue).filter(pubkey => !batchPubkeys.includes(pubkey)));

    batchPubkeys.forEach(pubkey => this.fetchingPubkeys.add(pubkey));

    try {
      await this._fetchProfileFromRelay(batchPubkeys);
    } catch (error) {
      console.error("プロフィールの取得に失敗:", error);
      this._handleFetchError(batchPubkeys);
    } finally {
      batchPubkeys.forEach(pubkey => {
        this.fetchingPubkeys.delete(pubkey);
        this.pendingFetches.delete(pubkey);
        this.resolvers.delete(pubkey);
      });

      if (this.batchQueue.size > 0) {
        this._scheduleBatchProcess();
      }
    }
  }

  async _fetchProfileFromRelay(pubkeys) {
    const profiles = await profilePool.querySync(this._config.RELAYS, {
      kinds: [0],
      authors: pubkeys,
    });

    const latestProfiles = Array.from(
      profiles.reduce((map, profile) => {
        const existing = map.get(profile.pubkey);
        if (!existing || existing.created_at < profile.created_at) {
          map.set(profile.pubkey, profile);
        }
        return map;
      }, new Map())
    ).map(([_, profile]) => profile);

    await Promise.all(
      latestProfiles.map(async profile => {
        try {
          const parsedContent = JSON.parse(profile.content);
          const parsedProfile = {
            ...parsedContent,
            name: getProfileDisplayName(parsedContent) || "nameless",
          };
          this.profileCache.set(profile.pubkey, parsedProfile);
          this._resolvePromise(profile.pubkey, parsedProfile);
        } catch (error) {
          console.error(`プロフィールのパース失敗: ${profile.pubkey}`, error);
          this._resolvePromise(profile.pubkey, this._createDefaultProfile());
        }
      })
    );

    pubkeys.forEach(pubkey => {
      if (!this.profileCache.has(pubkey)) {
        this.profileCache.set(pubkey, null);
        this._resolvePromise(pubkey, null);
      }
    });
  }

  async verifyNip05Async(pubkey) {
    if (this.nip05Cache.has(pubkey)) {
      return this.nip05Cache.get(pubkey);
    }

    if (this.nip05PendingFetches.has(pubkey)) {
      return this.nip05PendingFetches.get(pubkey);
    }

    const fetchPromise = (async () => {
      const NIP05_TIMEOUT = 5000;

      try {
        const profile = await this.fetchProfiles([pubkey]).then(profiles => profiles[0]);
        if (!profile?.nip05) {
          this.nip05Cache.set(pubkey, null);
          return null;
        }

        const nip05Result = await Promise.race([
          verifyNip05(profile.nip05, pubkey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('NIP-05 verification timeout')), NIP05_TIMEOUT)),
        ]);

        if (nip05Result) {
          const formattedNip05 = nip05Result.startsWith("_@") ? nip05Result.slice(1) : nip05Result;
          this.nip05Cache.set(pubkey, formattedNip05);
          return formattedNip05;
        } else {
          this.nip05Cache.set(pubkey, null);
          return null;
        }
      } catch (error) {
        console.debug('NIP-05検証失敗またはタイムアウト:', error);
        this.nip05Cache.set(pubkey, null);
        return null;
      } finally {
        this.nip05PendingFetches.delete(pubkey);
      }
    })();

    this.nip05PendingFetches.set(pubkey, fetchPromise);
    return fetchPromise;
  }

  _resolvePromise(pubkey, profile) {
    const resolver = this.resolvers.get(pubkey);
    if (resolver) {
      resolver(profile);
      this.resolvers.delete(pubkey);
    }
  }

  _handleFetchError(pubkeys) {
    pubkeys.forEach(pubkey => {
      const defaultProfile = this._createDefaultProfile();
      this.profileCache.set(pubkey, defaultProfile);
      this._resolvePromise(pubkey, defaultProfile);
    });
  }

  _createDefaultProfile() {
    return {
      name: "anonymous",
      display_name: "anonymous",
    };
  }

  clearCache() {
    // キャッシュをクリア
    this.profileCache.clear();
    this.nip05Cache.clear();
    this.pendingFetches.clear();
    this.nip05PendingFetches.clear();
    this.resolvers.clear();
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
}

export const profileManager = new ProfileManager();
