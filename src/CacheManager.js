import { APP_CONFIG } from "./AppSettings.js";

class BaseCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = new Map(); // LRU追跡用
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // 最も古いエントリーを削除
      const oldestKey = this.accessOrder.keys().next().value;
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
    this.cache.set(key, value);
    this.accessOrder.delete(key);
    this.accessOrder.set(key, Date.now());
  }

  get(key) {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // アクセス順を更新
      this.accessOrder.delete(key);
      this.accessOrder.set(key, Date.now());
    }
    return value;
  }

  has(key) { return this.cache.has(key); }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
}

export class CacheManager {
  #instance = null;
  #profileUpdateCallbacks = new Map();
  #referenceFetching = new Map();
  #relayUrls = null;

  constructor() {
    if (this.#instance) return this.#instance;

    const CACHE_NAMES = [
      'reference', 'zapInfo', 'uiComponent', 'decoded',
      'profile', 'nip05', 'nip05PendingFetches', 'zapEvents',
      'zapLoadStates', 'profileFetching', 'imageCache'
    ];

    this.caches = CACHE_NAMES.reduce((acc, name) => ({
      ...acc,
      [name]: new BaseCache()
    }), {});

    this.viewStats = new Map();
    this.viewStates = new Map();

    this.#instance = this;
  }

  // キャッシュ操作の基本メソッド
  _cacheOperation(cacheName, operation, key, value) {
    const cache = this.caches[cacheName];
    if (!cache) return null;
    
    return cache[operation]?.(key, value);
  }

  // 統一されたキャッシュアクセスメソッド
  setCacheItem(cacheName, key, value) { return this._cacheOperation(cacheName, 'set', key, value); }
  getCacheItem(cacheName, key) { return this._cacheOperation(cacheName, 'get', key); }
  hasCacheItem(cacheName, key) { return this._cacheOperation(cacheName, 'has', key); }
  deleteCacheItem(cacheName, key) { return this._cacheOperation(cacheName, 'delete', key); }
  clearCacheItems(cacheName) { return this._cacheOperation(cacheName, 'clear'); }

  // プロフィール関連の統合メソッド
  async getOrFetchProfile(pubkey, fetchFn) {
    const cached = this.getCacheItem('profile', pubkey);
    if (cached) return cached;

    const fetching = this.getCacheItem('profileFetching', pubkey);
    if (fetching) return fetching;

    const promise = fetchFn(pubkey).then(profile => {
      if (profile) this.notifyProfileUpdate(pubkey, profile);
      this.deleteCacheItem('profileFetching', pubkey);
      return profile;
    });

    this.setCacheItem('profileFetching', pubkey, promise);
    return promise;
  }

  // イベント処理の統一メソッド
  _processEvent(event, existingEvents) {
    return existingEvents.some(e => 
      e.id === event.id || 
      (e.kind === event.kind && 
       e.pubkey === event.pubkey && 
       e.content === event.content && 
       e.created_at === event.created_at)
    );
  }

  // View状態管理の統合メソッド
  getOrCreateViewState(viewId, defaultState = {}) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, defaultState);
    }
    return this.viewStates.get(viewId);
  }

  // キャッシュクリア操作の統合
  clearViewCache(viewId) {
    ['zapEvents', 'zapLoadStates'].forEach(cache => 
      this.deleteCacheItem(cache, viewId)
    );
    this.viewStats.delete(viewId);
    this.viewStates.delete(viewId);
  }

  // Reference methods
  setReference(eventId, reference) { this.setCacheItem('reference', eventId, reference); }
  getReference(eventId) { return this.getCacheItem('reference', eventId); }
  clearReference(eventId) { this.deleteCacheItem('reference', eventId); }

  // 参照情報の取得とフェッチを一元管理
  async getOrFetchReference(eventId, fetchFn) {
    const cached = this.getReference(eventId);
    if (cached) return cached;

    const fetching = this.#referenceFetching.get(eventId);
    if (fetching) return fetching;

    const promise = fetchFn().then(reference => {
      if (reference) {
        this.setReference(eventId, reference);
      }
      this.#referenceFetching.delete(eventId);
      return reference;
    }).catch(error => {
      console.error("Reference fetch failed:", error);
      this.#referenceFetching.delete(eventId);
      return null;
    });

    this.#referenceFetching.set(eventId, promise);
    return promise;
  }

  // ZapInfo methods
  setZapInfo(eventId, info) { this.setCacheItem('zapInfo', eventId, info); }
  getZapInfo(eventId) { return this.getCacheItem('zapInfo', eventId); }
  clearZapInfo(eventId) { this.deleteCacheItem('zapInfo', eventId); }

  // UI Component cache methods
  setUIComponent(referenceId, html) { this.setCacheItem('uiComponent', referenceId, html); }
  getUIComponent(referenceId) { return this.getCacheItem('uiComponent', referenceId); }
  clearUIComponent(referenceId) { this.deleteCacheItem('uiComponent', referenceId); }
  clearAllUIComponents() { this.clearCacheItems('uiComponent'); }

  // Reference component cache methods
  setReferenceComponent(referenceId, html) {
    if (!this.caches.uiComponent.has(referenceId)) {
      this.setCacheItem('uiComponent', referenceId, html);
    }
  }

  getReferenceComponent(referenceId) {
    return this.getCacheItem('uiComponent', referenceId);
  }

  // Clear methods
  clearAll() {
    Object.keys(this.caches).forEach(cacheName => this.clearCacheItems(cacheName));
    this.viewStats.clear();
    this.viewStates.clear();
  }

  // Decoded cache methods
  setDecoded(key, value) { this.setCacheItem('decoded', key, value); }
  getDecoded(key) { return this.getCacheItem('decoded', key); }
  hasDecoded(key) { return this.caches.decoded.has(key); }
  clearDecoded() { this.clearCacheItems('decoded'); }

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
  setProfile(pubkey, profile) { this.setCacheItem('profile', pubkey, profile); }
  getProfile(pubkey) { return this.getCacheItem('profile', pubkey); }
  hasProfile(pubkey) { return this.caches.profile.has(pubkey); }

  setProfileFetching(pubkey, promise) {
    this.setCacheItem('profileFetching', pubkey, promise);
  }

  getProfileFetching(pubkey) {
    return this.getCacheItem('profileFetching', pubkey);
  }

  clearProfileFetching(pubkey) {
    this.deleteCacheItem('profileFetching', pubkey);
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
  setNip05(pubkey, nip05) { this.setCacheItem('nip05', pubkey, nip05); }
  getNip05(pubkey) { return this.getCacheItem('nip05', pubkey); }
  setNip05PendingFetch(pubkey, promise) { this.setCacheItem('nip05PendingFetches', pubkey, promise); }
  getNip05PendingFetch(pubkey) { return this.getCacheItem('nip05PendingFetches', pubkey); }
  deleteNip05PendingFetch(pubkey) { this.deleteCacheItem('nip05PendingFetches', pubkey); }

  // イベント処理メソッドを修正
  _processEvents(events, eventId) {
    const targetEvent = events.find(e => e.id === eventId);
    return events.some(e => 
      e.id === eventId || 
      (targetEvent && 
       e.kind === targetEvent.kind && 
       e.pubkey === targetEvent.pubkey && 
       e.content === targetEvent.content && 
       e.created_at === targetEvent.created_at)
    );
  }

  // Zap events cache methods
  getZapEvents(viewId) { return this.getCacheItem('zapEvents', viewId) || []; }
  setZapEvents(viewId, events, maintainOrder = false) {
    const currentEvents = maintainOrder ? this.getZapEvents(viewId) : [];
    
    // 新しいイベントをマップに変換
    const newEventsMap = new Map(events.map(e => [e.id, e]));
    
    // 既存のイベントから重複を除外して保持
    const existingEvents = currentEvents.filter(e => !newEventsMap.has(e.id));
    
    // 結合して保存
    const mergedEvents = [...existingEvents, ...events];
    this.setCacheItem('zapEvents', viewId, mergedEvents);
  }

  addZapEvent(viewId, event) {
    if (!event?.id) return false;
    
    const events = this.getZapEvents(viewId);
    if (this._processEvents(events, event.id)) {
      return false;
    }

    // 既存のイベントリストを維持しながら追加
    events.push(event);
    // created_atでソート
    events.sort((a, b) => b.created_at - a.created_at);
    this.setZapEvents(viewId, events, true);
    return true;
  }

  // Load state management
  getLoadState(viewId) {
    if (!this.caches.zapLoadStates.has(viewId)) {
      this.caches.zapLoadStates.set(viewId, { isInitialFetchComplete: false, isLoading: false, lastEventTime: null });
    }
    return this.getCacheItem('zapLoadStates', viewId);
  }

  updateLoadState(viewId, updates) {
    const currentState = this.getLoadState(viewId);
    this.setCacheItem('zapLoadStates', viewId, { ...currentState, ...updates });
  }

  clearViewCache(viewId) {
    ['zapEvents', 'zapLoadStates', 'viewStats', 'viewStates'].forEach(cacheName => this.deleteCacheItem(cacheName, viewId));
  }

  // View状態管理メソッドを追加
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
    // リレーURLを設定
    this.setRelayUrls(config.relayUrls);
    
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
    this.setCacheItem('imageCache', url, img);
  }

  getImageCache(url) {
    return this.getCacheItem('imageCache', url);
  }

  hasImageCache(url) {
    return this.caches.imageCache.has(url);
  }

  setRelayUrls(urls) {
    this.#relayUrls = urls;
  }

  getRelayUrls() {
    return this.#relayUrls;
  }
}

export const cacheManager = new CacheManager();
