import { getProfileDisplayName, verifyNip05, escapeHTML } from "./utils.js";
import { APP_CONFIG } from "./AppSettings.js";
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

export class ProfilePool {
  static instance = null;
  #config;
  #simplePool;
  #isInitialized = true; // 初期値をtrueに変更
  #profileProcessor;

  constructor() {
    if (ProfilePool.instance) return ProfilePool.instance;
    
    this.#initializePool();
    ProfilePool.instance = this;
    return this;
  }

  #initializePool() {
    this.#config = APP_CONFIG.PROFILE_CONFIG;
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
  }

  // Core Methods
  get isInitialized() {
    return this.#isInitialized;
  }

  // Profile Fetching Methods
  async fetchProfiles(pubkeys) {
    if (!Array.isArray(pubkeys) || pubkeys.length === 0) return [];

    const now = Date.now();
    const results = new Array(pubkeys.length);
    const fetchQueue = pubkeys.reduce((queue, pubkey, i) => {
      const cached = cacheManager.getProfile(pubkey);
      if (this.#isValidCache(cached, now)) {
        results[i] = cached;
      } else {
        queue.push({ index: i, pubkey });
      }
      return queue;
    }, []);

    if (fetchQueue.length > 0) {
      await this.#processFetchQueue(fetchQueue, results, pubkeys);
    }

    return results;
  }

  // Batch Processing Methods
  async processBatchProfiles(events) {
    const pubkeys = this.#extractValidPubkeys(events);
    if (pubkeys.length === 0) return;

    try {
      await Promise.all([
        this.fetchProfiles(pubkeys),
        ...pubkeys.map(pubkey => this.verifyNip05Async(pubkey))
      ]);
    } catch (error) {
      console.warn('Batch profile processing failed:', error);
    }
  }

  // NIP-05 Verification Methods
  async verifyNip05Async(pubkey) {
    const cachedNip05 = cacheManager.getNip05(pubkey);
    if (cachedNip05 !== undefined) return cachedNip05;

    const pendingFetch = cacheManager.getNip05PendingFetch(pubkey);
    if (pendingFetch) return pendingFetch;

    const fetchPromise = this.#processNip05Verification(pubkey);
    cacheManager.setNip05PendingFetch(pubkey, fetchPromise);
    return fetchPromise;
  }

  getNip05(pubkey) {
    return cacheManager.getNip05(pubkey);
  }

  // Utility Methods
  clearCache() {
    cacheManager.clearAll();
    this.#profileProcessor.clearPendingFetches();
  }

  // Private Helper Methods
  #isValidCache(cached, now) {
    return cached && cached._lastUpdated && (now - cached._lastUpdated < 1800000);
  }

  #extractValidPubkeys(events) {
    return [...new Set(
      events
        ?.map(event => event?.pubkey)
        ?.filter(pubkey => pubkey && typeof pubkey === 'string' && pubkey.length === 64)
    )] || [];
  }

  async #processFetchQueue(fetchQueue, results, pubkeys) {
    if (!fetchQueue.length) return;

    const now = Date.now();
    const validQueue = fetchQueue.filter(({pubkey}) => 
      pubkey && typeof pubkey === 'string' && pubkey.length === 64
    );

    if (validQueue.length === 0) return;

    const fetchedProfiles = await Promise.all(
      validQueue.map(({ pubkey }) => this.#fetchSingleProfile(pubkey, now))
    );
    
    validQueue.forEach(({ index }, i) => {
      if (index >= 0 && index < results.length) {
        results[index] = fetchedProfiles[i];
        if (pubkeys[index]) {
          cacheManager.setProfile(pubkeys[index], fetchedProfiles[i]);
        }
      }
    });
  }

  async #fetchSingleProfile(pubkey, now) {
    if (!pubkey || typeof pubkey !== 'string' || pubkey.length !== 64) {
      console.warn('Invalid pubkey:', pubkey);
      return this.#createDefaultProfile();
    }

    try {
      const filter = {
        kinds: [0],
        authors: [pubkey],
        limit: 1
      };

      const event = await this.#profileProcessor.getOrCreateFetchPromise(pubkey, filter);
      if (!event?.content) return this.#createDefaultProfile();

      let content;
      try {
        content = JSON.parse(event.content);
      } catch (e) {
        console.warn('Invalid profile content:', e);
        return this.#createDefaultProfile();
      }

      return {
        ...content,
        name: getProfileDisplayName(content) || "nameless",
        _lastUpdated: now,
        _eventCreatedAt: event.created_at
      };
    } catch (error) {
      console.warn('Profile fetch failed:', error);
      return this.#createDefaultProfile();
    }
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

  #createDefaultProfile() {
    return {
      name: "anonymous",
      display_name: "anonymous",
    };
  }
}

export const profilePool = new ProfilePool();
