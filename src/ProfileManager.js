import { profilePool } from "./ZapPool.js";
import { getProfileDisplayName, verifyNip05, escapeHTML } from "./utils.js";
import { PROFILE_CONFIG } from "./AppSettings.js";
import { ProfileProcessor } from "./BatchProcessor.js";  // 明示的にProfileProcessorをインポート
import { cacheManager } from "./CacheManager.js";

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
    this.profileProcessor = new ProfileProcessor({ 
      profilePool,
      config: this._config 
    });
  }

  async fetchProfiles(pubkeys) {
    const uncachedPubkeys = pubkeys.filter(pubkey => !cacheManager.hasProfile(pubkey));
    
    if (uncachedPubkeys.length === 0) {
      return pubkeys.map(pubkey => cacheManager.getProfile(pubkey) || this._createDefaultProfile());
    }

    try {
      console.log("[ProfileManager] Fetching profiles:", uncachedPubkeys);
      
      const profilePromises = uncachedPubkeys.map(pubkey => 
        this.profileProcessor.getOrCreateFetchPromise(pubkey)
          .then(event => {
            if (!event) return this._createDefaultProfile();
            
            try {
              const content = JSON.parse(event.content);
              const processedProfile = {
                ...content,
                name: getProfileDisplayName(content) || "nameless",
                _lastUpdated: Date.now()
              };
              cacheManager.setProfile(event.pubkey, processedProfile);
              return processedProfile;
            } catch (error) {
              console.error("Profile processing error:", error);
              return this._createDefaultProfile();
            }
          })
      );

      await Promise.all(profilePromises);
      return pubkeys.map(pubkey => cacheManager.getProfile(pubkey) || this._createDefaultProfile());
    } catch (error) {
      console.error("Profile fetch error:", error);
      return pubkeys.map(() => this._createDefaultProfile());
    }
  }

  async verifyNip05Async(pubkey) {
    const cachedNip05 = cacheManager.getNip05(pubkey);
    if (cachedNip05 !== undefined) return cachedNip05;

    const pendingFetch = cacheManager.getNip05PendingFetch(pubkey);
    if (pendingFetch) return pendingFetch;

    const fetchPromise = this.#processNip05Verification(pubkey);
    cacheManager.setNip05PendingFetch(pubkey, fetchPromise);
    return fetchPromise;
  }

  async #processNip05Verification(pubkey) {
    try {
      const [profile] = await this.fetchProfiles([pubkey]);
      if (!profile?.nip05) {
        cacheManager.setNip05(pubkey, null);
        return null;
      }

      const nip05Result = await Promise.race([
        verifyNip05(profile.nip05, pubkey),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('NIP-05 timeout')), 5000)
        ),
      ]);

      if (!nip05Result) {
        cacheManager.setNip05(pubkey, null);
        return null;
      }

      const formattedNip05 = nip05Result.startsWith("_@") ? 
        nip05Result.slice(1) : nip05Result;
      const escapedNip05 = escapeHTML(formattedNip05);
      cacheManager.setNip05(pubkey, escapedNip05);
      return escapedNip05;

    } catch (error) {
      console.debug('NIP-05 verification failed:', error);
      cacheManager.setNip05(pubkey, null);
      return null;
    } finally {
      cacheManager.deleteNip05PendingFetch(pubkey);
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
      cacheManager.setProfile(pubkey, defaultProfile);
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
    cacheManager.clearAll();
  }

  /**
   * Get NIP-05 address
   * Returns cached verified and escaped NIP-05 address
   * @param {string} pubkey - Public key
   * @returns {string|null} Verified and escaped NIP-05 address
   */
  getNip05(pubkey) {
    return cacheManager.getNip05(pubkey);
  }
}

export const profileManager = new ProfileManager();
