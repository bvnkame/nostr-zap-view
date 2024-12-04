import { getProfileDisplayName, verifyNip05, escapeHTML } from "./utils.js";
import { PROFILE_CONFIG } from "./AppSettings.js";
import { ProfileProcessor } from "./BatchProcessor.js";
import { cacheManager } from "./CacheManager.js";
import { SimplePool } from "nostr-tools/pool";

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
export class ProfilePool {
  static instance = null;
  #config;
  #simplePool;
  #isInitialized = false;
  #profileProcessor;

  constructor() {
    if (ProfilePool.instance) return ProfilePool.instance;

    this.#config = PROFILE_CONFIG;
    this.#simplePool = new SimplePool();

    if (!this.#simplePool?.ensureRelay) {
      throw new Error('Failed to initialize SimplePool');
    }

    this.#profileProcessor = new ProfileProcessor({ 
      simplePool: this.#simplePool,
      config: {
        ...this.#config,
        RELAYS: this.#config.RELAYS || []
      }
    });

    ProfilePool.instance = this;
    return this;
  }

  // Add public getter
  get isInitialized() {
    return this.#isInitialized;
  }

  // Change from private to public method
  async initialize() {
    return this.#initialize();
  }

  async #initialize() {
    if (this.#isInitialized) return;
    
    try {
      const connectedCount = await this.#profileProcessor.connectToRelays();
      console.log(`Profile relays connected (${connectedCount}/${this.#config.RELAYS.length})`);
      this.#isInitialized = true;
    } catch (error) {
      console.error('ProfilePool initialization error:', error);
      this.#isInitialized = false;
      throw error;
    }
  }

  async fetchProfiles(pubkeys) {
    if (!Array.isArray(pubkeys) || pubkeys.length === 0) return [];

    const now = Date.now();
    const results = new Array(pubkeys.length);
    const fetchQueue = [];

    for (let i = 0; i < pubkeys.length; i++) {
      const pubkey = pubkeys[i];
      const cached = cacheManager.getProfile(pubkey);
      
      if (this.#isValidCache(cached, now)) {
        results[i] = cached;
      } else {
        fetchQueue.push({ index: i, pubkey });
      }
    }

    if (fetchQueue.length > 0) {
      await this.#processFetchQueue(fetchQueue, results, pubkeys);
    }

    return results;
  }

  #isValidCache(cached, now) {
    return cached && cached._lastUpdated && (now - cached._lastUpdated < 1800000);
  }

  async #processFetchQueue(fetchQueue, results, pubkeys) {
    const now = Date.now();
    const fetchedProfiles = await Promise.all(
      fetchQueue.map(({ pubkey }) => this.#fetchSingleProfile(pubkey, now))
    );
    
    fetchQueue.forEach(({ index }, i) => {
      results[index] = fetchedProfiles[i];
      cacheManager.setProfile(pubkeys[index], fetchedProfiles[i]);
    });
  }

  async #fetchSingleProfile(pubkey, now) {
    try {
      const event = await this.#profileProcessor.getOrCreateFetchPromise(pubkey);
      if (!event) return this.#createDefaultProfile();

      const content = JSON.parse(event.content);
      return {
        ...content,
        name: getProfileDisplayName(content) || "nameless",
        _lastUpdated: now,
        _eventCreatedAt: event.created_at
      };
    } catch {
      return this.#createDefaultProfile();
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
      const defaultProfile = this.#createDefaultProfile();
      cacheManager.setProfile(pubkey, defaultProfile);
      this._resolvePromise(pubkey, defaultProfile);
    });
  }

  #createDefaultProfile() {
    return {
      name: "anonymous",
      display_name: "anonymous",
    };
  }

  clearCache() {
    cacheManager.clearAll();
    this.#profileProcessor.clearPendingFetches();
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

  // 新しく追加: 複数のプロファイルを並行処理
  async processBatchProfiles(events) {
    const pubkeys = [...new Set(events.map(event => event.pubkey))];
    if (pubkeys.length === 0) return;

    await Promise.all([
      this.fetchProfiles(pubkeys),
      ...pubkeys.map(pubkey => this.verifyNip05Async(pubkey))
    ]);
  }

  // 新しく追加: プロファイルとNIP-05の検証を一括処理
  async processEventProfiles(events) {
    const pubkeys = [...new Set(events.map(event => event.pubkey))];
    await this.processBatchProfiles(pubkeys);
  }
}

export const profilePool = new ProfilePool();
