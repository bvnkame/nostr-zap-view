import { APP_CONFIG } from "./AppSettings.js";

class BaseCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get(key) { return this.cache.get(key); }
  has(key) { return this.cache.has(key); }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
}

export class CacheManager {
  #instance = null;

  constructor() {
    if (this.#instance) return this.#instance;

    this.reference = new BaseCache();
    this.zapInfo = new BaseCache();
    this.uiComponent = new BaseCache();
    this.decoded = new BaseCache();
    this.viewStats = new Map();
    this.viewStates = new Map();
    this.profile = new BaseCache();
    this.nip05 = new BaseCache();
    this.nip05PendingFetches = new BaseCache();
    this.zapEvents = new BaseCache();
    this.zapLoadStates = new BaseCache();

    this.#instance = this;
  }

  // Reference methods
  setReference(eventId, reference) { this.reference.set(eventId, reference); }
  getReference(eventId) { return this.reference.get(eventId); }
  clearReference(eventId) { this.reference.delete(eventId); }

  // ZapInfo methods
  setZapInfo(eventId, info) { this.zapInfo.set(eventId, info); }
  getZapInfo(eventId) { return this.zapInfo.get(eventId); }
  clearZapInfo(eventId) { this.zapInfo.delete(eventId); }

  // Reference component cache methods
  setReferenceComponent(referenceId, html) {
    if (!this.uiComponent.has(referenceId)) {
      this.uiComponent.set(referenceId, html);
    }
  }

  getReferenceComponent(referenceId) {
    return this.uiComponent.get(referenceId);
  }

  clearReferenceComponent(referenceId) {
    this.uiComponent.delete(referenceId);
  }

  clearAllReferenceComponents() {
    this.uiComponent.clear();
  }

  // UI Component cache methods
  setUIComponent(referenceId, html) {
    this.uiComponent.set(referenceId, html);
  }

  getUIComponent(referenceId) {
    return this.uiComponent.get(referenceId);
  }

  // Clear methods
  clearAll() {
    [this.reference, this.zapInfo, this.uiComponent, this.profile,
     this.nip05, this.nip05PendingFetches, this.zapEvents, 
     this.zapLoadStates].forEach(cache => cache.clear());
    
    this.viewStats.clear();
    this.viewStates.clear();
  }

  // Decoded cache methods
  setDecoded(key, value) {
    this.decoded.set(key, value);
  }

  getDecoded(key) {
    return this.decoded.get(key);
  }

  hasDecoded(key) {
    return this.decoded.has(key);
  }

  clearDecoded() {
    this.decoded.clear();
  }

  // View stats cache methods
  getOrCreateViewCache(viewId) {
    if (!this.viewStats.has(viewId)) {
      this.viewStats.set(viewId, new Map());
    }
    return this.viewStats.get(viewId);
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

  // Profile cache methods
  setProfile(pubkey, profile) {
    this.profile.set(pubkey, profile);
  }

  getProfile(pubkey) {
    return this.profile.get(pubkey);
  }

  hasProfile(pubkey) {
    return this.profile.has(pubkey);
  }

  // NIP-05 cache methods
  setNip05(pubkey, nip05) {
    this.nip05.set(pubkey, nip05);
  }

  getNip05(pubkey) {
    return this.nip05.get(pubkey);
  }

  setNip05PendingFetch(pubkey, promise) {
    this.nip05PendingFetches.set(pubkey, promise);
  }

  getNip05PendingFetch(pubkey) {
    return this.nip05PendingFetches.get(pubkey);
  }

  deleteNip05PendingFetch(pubkey) {
    this.nip05PendingFetches.delete(pubkey);
  }

  // Zap events cache methods
  getZapEvents(viewId) {
    return this.zapEvents.get(viewId) || [];
  }

  setZapEvents(viewId, events) {
    this.zapEvents.set(viewId, events);
  }

  addZapEvent(viewId, event) {
    const events = this.getZapEvents(viewId);
    const isDuplicate = events.some((e) => 
      e.id === event.id || 
      (e.kind === event.kind && 
       e.pubkey === event.pubkey && 
       e.content === event.content && 
       e.created_at === event.created_at)
    );

    if (!isDuplicate) {
      const updatedEvents = [...events, event];
      updatedEvents.sort((a, b) => b.created_at - a.created_at);
      this.setZapEvents(viewId, updatedEvents);
      return true;
    }
    return false;
  }

  // Load state management
  getLoadState(viewId) {
    if (!this.zapLoadStates.has(viewId)) {
      this.zapLoadStates.set(viewId, {
        isInitialFetchComplete: false,
        isLoading: false,
        lastEventTime: null
      });
    }
    return this.zapLoadStates.get(viewId);
  }

  updateLoadState(viewId, updates) {
    const currentState = this.getLoadState(viewId);
    this.zapLoadStates.set(viewId, { ...currentState, ...updates });
  }

  clearViewCache(viewId) {
    this.zapEvents.delete(viewId);
    this.zapLoadStates.delete(viewId);
    this.viewStats.delete(viewId);
    this.viewStates.delete(viewId);
  }

  getViewState(viewId, defaultState = {}) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, defaultState);
    }
    return this.viewStates.get(viewId);
  }

  updateViewState(viewId, updates) {
    const currentState = this.getViewState(viewId);
    this.viewStates.set(viewId, { ...currentState, ...updates });
    return this.viewStates.get(viewId);
  }

  // Theme state methods are now using the generic view state methods
  getThemeState(viewId) {
    return this.getViewState(viewId, {
      theme: APP_CONFIG.DEFAULT_OPTIONS.theme,
      maxCount: APP_CONFIG.DEFAULT_OPTIONS.maxCount,
      isInitialized: false
    });
  }

  updateThemeState(viewId, updates) {
    return this.updateViewState(viewId, updates);
  }

  getExistingEvents(list) {
    if (!list) return new Map();
    
    return new Map(
      Array.from(list.children)
        .filter(li => li.hasAttribute('data-event-id'))
        .map(li => [li.getAttribute('data-event-id'), {
          element: li,
          html: li.innerHTML,
          classes: li.className
        }])
    );
  }

  updateZapCache(event, zapInfo) {
    if (!event?.id) return;
    this.setZapInfo(event.id, zapInfo);
  }

  async processCachedData(viewId, config, renderCallback) {
    const cachedEvents = this.getZapEvents(viewId);
    const results = await Promise.all([
      this.getCachedStats(viewId, config.identifier),
      cachedEvents.length > 0 ? renderCallback(cachedEvents, viewId) : null
    ]);
    
    return {
      stats: results[0],
      hasEnoughCachedEvents: cachedEvents.length >= APP_CONFIG.INITIAL_LOAD_COUNT
    };
  }
}

export const cacheManager = new CacheManager();
