import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName } from "./utils.js";

/**
 * @typedef {Object} ProfileResult
 * @property {string} name
 * @property {string} display_name
 * @property {string} [picture]
 * @property {string} [about]
 */

export class ProfileManager {
  static #instance = null;

  static getInstance() {
    if (!ProfileManager.#instance) {
      ProfileManager.#instance = new ProfileManager();
    }
    return ProfileManager.#instance;
  }

  #config = {
    BATCH_SIZE: 20,
    BATCH_DELAY: 100,
    CACHE_EXPIRE: 1000 * 60 * 5, // 5分
    RELAYS: ["wss://purplepag.es", "wss://directory.yabu.me", "wss://relay.nostr.band"],
  };

  constructor() {
    if (ProfileManager.#instance) {
      throw new Error("Use ProfileManager.getInstance()");
    }
    this.#initialize();
  }

  #initialize() {
    this.profileCache = new Map();
    this.profileFetchPromises = new Map();
    this.batchQueue = new Set();
    this.resolvers = new Map();

    // 定期的なキャッシュクリーンアップ
    setInterval(() => this.#cleanupExpiredCache(), this.#config.CACHE_EXPIRE);
  }

  #cleanupExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.profileCache.entries()) {
      if (value.timestamp < now - this.#config.CACHE_EXPIRE) {
        this.profileCache.delete(key);
      }
    }
  }

  /**
   * @param {string} pubkey
   * @returns {Promise<ProfileResult>}
   */
  async fetchProfile(pubkey) {
    if (this.profileCache.has(pubkey)) {
      return this.profileCache.get(pubkey);
    }

    return this._getOrCreateFetchPromise(pubkey);
  }

  /**
   * @param {string[]} pubkeys
   * @returns {Promise<ProfileResult[]>}
   */
  async fetchProfiles(pubkeys) {
    const uncachedPubkeys = pubkeys.filter((key) => !this.profileCache.has(key));

    if (uncachedPubkeys.length > 0) {
      await this._batchFetch(uncachedPubkeys);
    }

    return pubkeys.map((key) => this.profileCache.get(key) || this._createDefaultProfile());
  }

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

  _scheduleBatchProcess() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.batchTimer = setTimeout(() => this._processBatchQueue(), this.#config.BATCH_DELAY);
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

  async _processBatchQueue() {
    if (this.batchQueue.size === 0) return;

    const batchPubkeys = Array.from(this.batchQueue).slice(0, this.#config.BATCH_SIZE);
    this.batchQueue = new Set(Array.from(this.batchQueue).slice(this.#config.BATCH_SIZE));

    await this._fetchProfileFromRelay(batchPubkeys);

    if (this.batchQueue.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#config.BATCH_DELAY));
      await this._processBatchQueue();
    }
  }

  async _fetchProfileFromRelay(pubkeys) {
    try {
      const profiles = await profilePool.querySync(this.#config.RELAYS, {
        kinds: [0],
        authors: pubkeys,
      });

      this._processProfiles(profiles);

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

  _processProfiles(profiles) {
    profiles.forEach((profile) => {
      try {
        const parsedProfile = {
          ...JSON.parse(profile.content),
          name: getProfileDisplayName(JSON.parse(profile.content)),
        };

        this.profileCache.set(profile.pubkey, parsedProfile);
        this._resolvePromise(profile.pubkey, parsedProfile);
      } catch (error) {
        console.error(`プロフィールのパース失敗: ${profile.pubkey}`, error);
        this._resolvePromise(profile.pubkey, this._createDefaultProfile());
      }
    });
  }

  _createDefaultProfile() {
    return {
      name: "Unknown",
      display_name: "Unknown",
    };
  }

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

  clearCache() {
    this.profileCache.clear();
    this.profileFetchPromises.clear();
    this.resolvers.clear();
  }
}

export const profileManager = ProfileManager.getInstance();
