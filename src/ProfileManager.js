import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName, verifyNip05, escapeHTML } from "./utils.js";
import { PROFILE_CONFIG } from "./ZapConfig.js";
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
    const profiles = await profilePool.querySync(this.config.RELAYS, {
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
          this.profileManager.profileCache.set(profile.pubkey, parsedProfile);
          this.resolveItem(profile.pubkey, parsedProfile);
        } catch (error) {
          console.error(`Failed to parse profile: ${profile.pubkey}`, error);
          this.resolveItem(profile.pubkey, this.profileManager._createDefaultProfile());
        }
      })
    );

    pubkeys.forEach(pubkey => {
      if (!this.profileManager.profileCache.has(pubkey)) {
        this.profileManager.profileCache.set(pubkey, null);
        this.resolveItem(pubkey, null);
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
          // エスケープしてからキャッシュに保存
          const escapedNip05 = escapeHTML(formattedNip05);
          this.nip05Cache.set(pubkey, escapedNip05);
          return escapedNip05;
        } else {
          this.nip05Cache.set(pubkey, null);
          return null;
        }
      } catch (error) {
        console.debug('NIP-05 verification failed or timed out:', error);
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
