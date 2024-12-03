const CACHE_MAX_SIZE = 1000;

export class CacheManager {
  static instance = null;
  
  constructor() {
    if (CacheManager.instance) {
      return CacheManager.instance;
    }
    this.referenceCache = new Map();
    this.zapInfoCache = new Map();
    this.uiComponentCache = new Map();
    this.decodedCache = new Map();
    this.viewStatsCache = new Map();
    this.viewStates = new Map();
    this.maxSize = CACHE_MAX_SIZE;
    CacheManager.instance = this;
  }

  // Reference cache methods
  setReference(eventId, reference) {
    this.referenceCache.set(eventId, reference);
  }

  getReference(eventId) {
    return this.referenceCache.get(eventId);
  }

  // ZapInfo cache methods
  setZapInfo(eventId, info) {
    this.zapInfoCache.set(eventId, info);
  }

  getZapInfo(eventId) {
    return this.zapInfoCache.get(eventId);
  }

  // UI Component cache methods
  setUIComponent(referenceId, html) {
    this.uiComponentCache.set(referenceId, html);
  }

  getUIComponent(referenceId) {
    return this.uiComponentCache.get(referenceId);
  }

  // Clear methods
  clearAll() {
    this.referenceCache.clear();
    this.zapInfoCache.clear();
    this.uiComponentCache.clear();
  }

  clearReference(eventId) {
    this.referenceCache.delete(eventId);
  }

  clearZapInfo(eventId) {
    this.zapInfoCache.delete(eventId);
  }

  clearUIComponent(referenceId) {
    this.uiComponentCache.delete(referenceId);
  }

  // Decoded cache methods
  setDecoded(key, value) {
    if (this.decodedCache.size >= this.maxSize) {
      const firstKey = this.decodedCache.keys().next().value;
      this.decodedCache.delete(firstKey);
    }
    this.decodedCache.set(key, value);
  }

  getDecoded(key) {
    return this.decodedCache.get(key);
  }

  hasDecoded(key) {
    return this.decodedCache.has(key);
  }

  clearDecoded() {
    this.decodedCache.clear();
  }

  // View stats cache methods
  getOrCreateViewCache(viewId) {
    if (!this.viewStatsCache.has(viewId)) {
      this.viewStatsCache.set(viewId, new Map());
    }
    return this.viewStatsCache.get(viewId);
  }

  getOrCreateViewState(viewId) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, {
        currentStats: null
      });
    }
    return this.viewStates.get(viewId);
  }

  getCachedStats(viewId, identifier) {
    const viewCache = this.getOrCreateViewCache(viewId);
    return viewCache.get(identifier);
  }

  updateStatsCache(viewId, identifier, stats) {
    const viewCache = this.getOrCreateViewCache(viewId);
    viewCache.set(identifier, {
      stats,
      timestamp: Date.now(),
    });
  }

  getViewIdentifier(viewId) {
    const viewCache = this.getOrCreateViewCache(viewId);
    return Array.from(viewCache.keys())[0];
  }
}

export const cacheManager = new CacheManager();
