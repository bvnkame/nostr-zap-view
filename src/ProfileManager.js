import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName, verifyNip05, escapeHTML } from "./utils.js";
import { PROFILE_CONFIG } from "./AppSettings.js";
import { BatchProcessor } from "./BatchProcessor.js";

/**
 * @typedef {Object} ProfileResult
 * @property {string} name
 * @property {string} display_name
 * @property {string} [picture]
 * @property {string} [about]
 */

/**
 * Class to manage Nostr profile information
 * Singleton pattern is adopted to share one instance throughout the application
 */
class ProfileBatchProcessor extends BatchProcessor {
  constructor(profileManager, config) {
    super({
      batchSize: config.BATCH_SIZE,
      batchDelay: config.BATCH_DELAY
    });
    this.profileManager = profileManager;
    this.config = config;
  }

  async onBatchProcess(pubkeys) {
    // プロフィール情報の一括取得
    const profiles = await profilePool.querySync(this.config.RELAYS, {
      kinds: [0],
      authors: pubkeys,
    });

    // プロフィール情報の高速な処理
    const profileMap = new Map();
    profiles.forEach(profile => {
      const existing = profileMap.get(profile.pubkey);
      if (!existing || existing.created_at < profile.created_at) {
        profileMap.set(profile.pubkey, profile);
      }
    });

    // バッチ処理による一括更新
    await Promise.all(
      Array.from(profileMap.values()).map(async profile => {
        try {
          const content = JSON.parse(profile.content);
          const processedProfile = {
            ...content,
            name: getProfileDisplayName(content) || "nameless",
            _lastUpdated: Date.now()
          };
          this.profileManager.profileCache.set(profile.pubkey, processedProfile);
          this.resolveItem(profile.pubkey, processedProfile);
        } catch (error) {
          const defaultProfile = this.profileManager._createDefaultProfile();
          this.profileManager.profileCache.set(pubkey, defaultProfile);
          this.resolveItem(pubkey, defaultProfile);
        }
      })
    );

    // 未取得のプロフィールにデフォルト値を設定
    pubkeys.forEach(pubkey => {
      if (!this.profileManager.profileCache.has(pubkey)) {
        const defaultProfile = this.profileManager._createDefaultProfile();
        this.profileManager.profileCache.set(pubkey, defaultProfile);
        this.resolveItem(pubkey, defaultProfile);
      }
    });
  }

  onBatchError(pubkeys, error) {
    pubkeys.forEach(pubkey => {
      const defaultProfile = this.profileManager._createDefaultProfile();
      this.profileManager.profileCache.set(pubkey, defaultProfile);
      this.resolveItem(pubkey, defaultProfile);
    });
  }
}

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
    // Initialize cache and queue
    this.profileCache = new Map();
    this.nip05Cache = new Map();
    this.nip05PendingFetches = new Map();
    this.batchProcessor = new ProfileBatchProcessor(this, this._config);
  }

  async fetchProfiles(pubkeys) {
    // Filter uncached public keys
    const uncachedPubkeys = pubkeys.filter(pubkey => !this.profileCache.has(pubkey));

    if (uncachedPubkeys.length === 0) {
      return pubkeys.map(pubkey => this.profileCache.get(pubkey) || this._createDefaultProfile());
    }

    // Schedule fetch for uncached public keys
    const fetchPromises = uncachedPubkeys.map(pubkey => this.batchProcessor.getOrCreateFetchPromise(pubkey));

    // Wait for fetch to complete
    await Promise.all(fetchPromises);

    // Return results
    return pubkeys.map(pubkey => this.profileCache.get(pubkey) || this._createDefaultProfile());
  }

  async verifyNip05Async(pubkey) {
    // キャッシュチェックを最適化
    const cachedNip05 = this.nip05Cache.get(pubkey);
    if (cachedNip05 !== undefined) return cachedNip05;

    const pendingFetch = this.nip05PendingFetches.get(pubkey);
    if (pendingFetch) return pendingFetch;

    const fetchPromise = this.#processNip05Verification(pubkey);
    this.nip05PendingFetches.set(pubkey, fetchPromise);
    return fetchPromise;
  }

  async #processNip05Verification(pubkey) {
    try {
      const [profile] = await this.fetchProfiles([pubkey]);
      if (!profile?.nip05) {
        this.nip05Cache.set(pubkey, null);
        return null;
      }

      const nip05Result = await Promise.race([
        verifyNip05(profile.nip05, pubkey),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('NIP-05 timeout')), 5000)
        ),
      ]);

      if (!nip05Result) {
        this.nip05Cache.set(pubkey, null);
        return null;
      }

      const formattedNip05 = nip05Result.startsWith("_@") ? 
        nip05Result.slice(1) : nip05Result;
      const escapedNip05 = escapeHTML(formattedNip05);
      this.nip05Cache.set(pubkey, escapedNip05);
      return escapedNip05;

    } catch (error) {
      console.debug('NIP-05 verification failed:', error);
      this.nip05Cache.set(pubkey, null);
      return null;
    } finally {
      this.nip05PendingFetches.delete(pubkey);
    }
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
    // Clear cache
    this.profileCache.clear();
    this.nip05Cache.clear();
    this.pendingFetches.clear();
    this.nip05PendingFetches.clear();
    this.resolvers.clear();
  }

  /**
   * Get NIP-05 address
   * Returns cached verified and escaped NIP-05 address
   * @param {string} pubkey - Public key
   * @returns {string|null} Verified and escaped NIP-05 address
   */
  getNip05(pubkey) {
    const nip05 = this.nip05Cache.get(pubkey);
    if (!nip05) return null;

    // キャッシュに保存時点でエスケープ済みなので、そのまま返す
    return nip05;
  }
}

export const profileManager = new ProfileManager();
