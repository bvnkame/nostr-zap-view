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
  #profileUpdateCallbacks = new Map();

  constructor() {
    if (this.#instance) return this.#instance;

    this.caches = {
      reference: new BaseCache(),
      zapInfo: new BaseCache(),
      uiComponent: new BaseCache(),
      decoded: new BaseCache(),
      profile: new BaseCache(),
      nip05: new BaseCache(),
      nip05PendingFetches: new BaseCache(),
      zapEvents: new BaseCache(),
      zapLoadStates: new BaseCache(),
      profileFetching: new BaseCache(), // Add: プロフィール取得中のPromiseを保持
      imageCache: new BaseCache(), // 画像キャッシュを追加
    };

    this.viewStats = new Map();
    this.viewStates = new Map();

    this.#instance = this;
  }

  // Cache methods
  setCache(cacheName, key, value) {
    this.caches[cacheName].set(key, value);
  }

  getCache(cacheName, key) {
    return this.caches[cacheName].get(key);
  }

  deleteCache(cacheName, key) {
    this.caches[cacheName].delete(key);
  }

  clearCache(cacheName) {
    this.caches[cacheName].clear();
  }

  // Reference methods
  setReference(eventId, reference) { this.setCache('reference', eventId, reference); }
  getReference(eventId) { return this.getCache('reference', eventId); }
  clearReference(eventId) { this.deleteCache('reference', eventId); }

  // ZapInfo methods
  setZapInfo(eventId, info) { this.setCache('zapInfo', eventId, info); }
  getZapInfo(eventId) { return this.getCache('zapInfo', eventId); }
  clearZapInfo(eventId) { this.deleteCache('zapInfo', eventId); }

  // UI Component cache methods
  setUIComponent(referenceId, html) { this.setCache('uiComponent', referenceId, html); }
  getUIComponent(referenceId) { return this.getCache('uiComponent', referenceId); }
  clearUIComponent(referenceId) { this.deleteCache('uiComponent', referenceId); }
  clearAllUIComponents() { this.clearCache('uiComponent'); }

  // Reference component cache methods
  setReferenceComponent(referenceId, html) {
    if (!this.caches.uiComponent.has(referenceId)) {
      this.setCache('uiComponent', referenceId, html);
    }
  }

  getReferenceComponent(referenceId) {
    return this.getCache('uiComponent', referenceId);
  }

  // Clear methods
  clearAll() {
    Object.keys(this.caches).forEach(cacheName => this.clearCache(cacheName));
    this.viewStats.clear();
    this.viewStates.clear();
  }

  // Decoded cache methods
  setDecoded(key, value) { this.setCache('decoded', key, value); }
  getDecoded(key) { return this.getCache('decoded', key); }
  hasDecoded(key) { return this.caches.decoded.has(key); }
  clearDecoded() { this.clearCache('decoded'); }

  // View stats cache methods
  getOrCreateViewCache(viewId) {
    if (!this.viewStats.has(viewId)) {
      this.viewStats.set(viewId, new Map());
    }
    return this.viewStats.get(viewId);
  }

  getOrCreateViewState(viewId) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, { currentStats: null });
    }
    return this.viewStates.get(viewId);
  }

  getCachedStats(viewId, identifier) {
    const viewCache = this.getOrCreateViewCache(viewId);
    return viewCache.get(identifier);
  }

  updateStatsCache(viewId, identifier, stats) {
    const viewCache = this.getOrCreateViewCache(viewId);
    viewCache.set(identifier, { stats, timestamp: Date.now() });
  }

  getViewIdentifier(viewId) {
    const viewCache = this.getOrCreateViewCache(viewId);
    return Array.from(viewCache.keys())[0];
  }

  // Profile cache methods
  setProfile(pubkey, profile) { this.setCache('profile', pubkey, profile); }
  getProfile(pubkey) { return this.getCache('profile', pubkey); }
  hasProfile(pubkey) { return this.caches.profile.has(pubkey); }

  setProfileFetching(pubkey, promise) {
    this.setCache('profileFetching', pubkey, promise);
  }

  getProfileFetching(pubkey) {
    return this.getCache('profileFetching', pubkey);
  }

  clearProfileFetching(pubkey) {
    this.deleteCache('profileFetching', pubkey);
  }

  async getOrFetchProfile(pubkey, fetchFn) {
    const cached = this.getProfile(pubkey);
    if (cached) return cached;

    // 既に取得中のPromiseがあればそれを返す
    const fetching = this.getProfileFetching(pubkey);
    if (fetching) return fetching;

    // 新しく取得を開始
    const promise = fetchFn(pubkey).then(profile => {
      if (profile) this.setProfile(pubkey, profile);
      this.clearProfileFetching(pubkey);
      return profile;
    });

    this.setProfileFetching(pubkey, promise);
    return promise;
  }

  // プロフィール更新通知の購読
  subscribeToProfileUpdates(callback) {
    const id = Math.random().toString(36).substr(2, 9);
    this.#profileUpdateCallbacks.set(id, callback);
    return () => {
      this.#profileUpdateCallbacks.delete(id);
    };
  }

  // プロフィール更新の通知
  notifyProfileUpdate(pubkey, profile) {
    const oldProfile = this.getProfile(pubkey);
    if (!oldProfile || 
        !oldProfile._eventCreatedAt || 
        !profile._eventCreatedAt ||
        profile._eventCreatedAt > oldProfile._eventCreatedAt) {
      this.setProfile(pubkey, profile);
      this.#profileUpdateCallbacks.forEach(callback => {
        try {
          callback(pubkey, profile);
        } catch (error) {
          console.error('Profile update callback error:', error);
        }
      });
    }
  }

  // NIP-05 cache methods
  setNip05(pubkey, nip05) { this.setCache('nip05', pubkey, nip05); }
  getNip05(pubkey) { return this.getCache('nip05', pubkey); }
  setNip05PendingFetch(pubkey, promise) { this.setCache('nip05PendingFetches', pubkey, promise); }
  getNip05PendingFetch(pubkey) { return this.getCache('nip05PendingFetches', pubkey); }
  deleteNip05PendingFetch(pubkey) { this.deleteCache('nip05PendingFetches', pubkey); }

  // Zap events cache methods
  getZapEvents(viewId) { return this.getCache('zapEvents', viewId) || []; }
  setZapEvents(viewId, events) { this.setCache('zapEvents', viewId, events); }
  addZapEvent(viewId, event) {
    const events = this.getZapEvents(viewId);
    const isDuplicate = events.some(e => e.id === event.id || (e.kind === event.kind && e.pubkey === event.pubkey && e.content === event.content && e.created_at === event.created_at));
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
    if (!this.caches.zapLoadStates.has(viewId)) {
      this.caches.zapLoadStates.set(viewId, { isInitialFetchComplete: false, isLoading: false, lastEventTime: null });
    }
    return this.getCache('zapLoadStates', viewId);
  }

  updateLoadState(viewId, updates) {
    const currentState = this.getLoadState(viewId);
    this.setCache('zapLoadStates', viewId, { ...currentState, ...updates });
  }

  clearViewCache(viewId) {
    ['zapEvents', 'zapLoadStates', 'viewStats', 'viewStates'].forEach(cacheName => this.deleteCache(cacheName, viewId));
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
        .map(li => [li.getAttribute('data-event-id'), { element: li, html: li.innerHTML, classes: li.className }])
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

  // 画像キャッシュ用メソッドを追加
  setImageCache(url, img) {
    this.setCache('imageCache', url, img);
  }

  getImageCache(url) {
    return this.getCache('imageCache', url);
  }

  hasImageCache(url) {
    return this.caches.imageCache.has(url);
  }
}

export const cacheManager = new CacheManager();
