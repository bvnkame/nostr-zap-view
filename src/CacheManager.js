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

class ProfileCache extends BaseCache {
  #updateCallbacks = new Map();

  setProfile(pubkey, profile) {
    if (!pubkey || !profile) return;
    
    const oldProfile = this.get(pubkey);
    if (!oldProfile || 
        !oldProfile._eventCreatedAt || 
        !profile._eventCreatedAt ||
        profile._eventCreatedAt > oldProfile._eventCreatedAt) {
      this.set(pubkey, profile);
      this.#notifyUpdate(pubkey, profile);
    }
  }

  #notifyUpdate(pubkey, profile) {
    this.#updateCallbacks.forEach(callback => {
      try {
        callback(pubkey, profile);
      } catch (error) {
        console.error('Profile update callback error:', error);
      }
    });
  }

  subscribe(callback) {
    if (typeof callback !== 'function') return null;
    const id = Math.random().toString(36).substr(2, 9);
    this.#updateCallbacks.set(id, callback);
    return () => this.#updateCallbacks.delete(id);
  }

  clearSubscriptions() {
    this.#updateCallbacks.clear();
  }
}

class ZapEventCache extends BaseCache {
  #viewStates = new Map();

  initializeView(viewId) {
    this.#viewStates.set(viewId, {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false,
      batchProcessing: false
    });
  }

  getViewState(viewId) {
    return this.#viewStates.get(viewId) || this.initializeView(viewId);
  }

  updateViewState(viewId, updates) {
    const currentState = this.getViewState(viewId);
    this.#viewStates.set(viewId, { ...currentState, ...updates });
    return this.#viewStates.get(viewId);
  }

  getEvents(viewId) {
    return this.get(viewId) || [];
  }

  setEvents(viewId, events, maintainOrder = false) {
    const currentEvents = maintainOrder ? this.getEvents(viewId) : [];
    const newEventsMap = new Map(events.map(e => [e.id, e]));
    const existingEvents = currentEvents.filter(e => !newEventsMap.has(e.id));
    const mergedEvents = [...existingEvents, ...events];
    this.set(viewId, mergedEvents);
  }

  addEvent(viewId, event) {
    if (!event?.id) return false;
    
    const events = this.getEvents(viewId);
    if (this.#isDuplicate(events, event)) return false;

    events.push(event);
    events.sort((a, b) => b.created_at - a.created_at);
    this.setEvents(viewId, events, true);
    return true;
  }

  #isDuplicate(events, event) {
    return events.some(e => 
      e.id === event.id || 
      (e.kind === event.kind && 
       e.pubkey === event.pubkey && 
       e.content === event.content && 
       e.created_at === event.created_at)
    );
  }
}

class ReferenceCache extends BaseCache {
  #pendingFetches = new Map();
  #components = new Map();  // コンポーネントキャッシュを追加

  async getOrFetch(eventId, fetchFn) {
    const cached = this.get(eventId);
    if (cached) return cached;

    const fetching = this.#pendingFetches.get(eventId);
    if (fetching) return fetching;

    const promise = fetchFn().then(reference => {
      if (reference) this.set(eventId, reference);
      this.#pendingFetches.delete(eventId);
      return reference;
    }).catch(error => {
      console.error("Reference fetch failed:", error);
      this.#pendingFetches.delete(eventId);
      return null;
    });

    this.#pendingFetches.set(eventId, promise);
    return promise;
  }

  clearPendingFetches() {
    this.#pendingFetches.clear();
  }

  // コンポーネント関連のメソッドを追加
  setComponent(eventId, html) {
    this.#components.set(eventId, html);
  }

  getComponent(eventId) {
    return this.#components.get(eventId);
  }

  clearComponents() {
    this.#components.clear();
  }

  clear() {
    super.clear();
    this.clearPendingFetches();
    this.clearComponents();
  }
}

class StatsCache extends BaseCache {
  #viewStats = new Map();

  setCached(viewId, identifier, stats) {
    const key = `${viewId}:${identifier}`;
    this.set(key, {
      stats,
      timestamp: Date.now()
    });
  }

  getCached(viewId, identifier) {
    const key = `${viewId}:${identifier}`;
    return this.get(key);
  }

  updateViewStats(viewId, stats) {
    this.#viewStats.set(viewId, stats);
  }

  getViewStats(viewId) {
    return this.#viewStats.get(viewId);
  }

  clearViewStats(viewId) {
    this.#viewStats.delete(viewId);
  }

  clear() {
    super.clear();
    this.#viewStats.clear();
  }
}

class DecodedCache extends BaseCache {
  // デコード結果のキャッシュ専用クラス
  hasDecoded(key) {
    return this.has(key);
  }

  setDecoded(key, value) {
    this.set(key, value);
  }

  getDecoded(key) {
    return this.get(key);
  }
}

class LoadStateCache extends BaseCache {
  #states = new Map();

  initializeLoadState(viewId) {
    const initialState = {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false,
      currentCount: 0
    };
    this.set(viewId, initialState);
    return initialState;
  }

  getLoadState(viewId) {
    if (!this.has(viewId)) {
      return this.initializeLoadState(viewId);
    }
    return this.get(viewId);
  }

  updateLoadState(viewId, updates) {
    const currentState = this.getLoadState(viewId);
    const newState = { ...currentState, ...updates };
    this.set(viewId, newState);
    return newState;
  }

  canLoadMore(viewId) {
    const state = this.getLoadState(viewId);
    return state && !state.isLoading && state.lastEventTime;
  }

  updateLoadProgress(viewId, count) {
    const state = this.getLoadState(viewId);
    state.currentCount += count;
    this.updateLoadState(viewId, { currentCount: state.currentCount });
    return state.currentCount;
  }
}

class ZapInfoCache extends BaseCache {
  setZapInfo(eventId, info) {
    this.set(eventId, info);
  }

  getZapInfo(eventId) {
    return this.get(eventId);
  }

  clearZapInfo(eventId) {
    this.delete(eventId);
  }
}

class ImageCache extends BaseCache {
  setImage(url, img) {
    this.set(url, img);
  }

  getImage(url) {
    return this.get(url);
  }

  hasImage(url) {
    return this.has(url);
  }
}

export class CacheManager {
  #instance = null;
  #relayUrls = null;
  #caches = {};

  constructor() {
    if (this.#instance) return this.#instance;

    // 専用キャッシュの初期化
    this.profileCache = new ProfileCache();
    this.zapEventCache = new ZapEventCache();
    this.referenceCache = new ReferenceCache();
    this.statsCache = new StatsCache(); // ViewStatsCacheをStatsCacheに置き換え
    this.decodedCache = new DecodedCache(); // 追加
    this.loadStateCache = new LoadStateCache(); // 追加
    this.zapInfoCache = new ZapInfoCache(); // 追加
    this.imageCache = new ImageCache(); // 追加

    // 汎用キャッシュの初期化
    const CACHE_NAMES = [
      'zapInfo', 'uiComponent', 'decoded', 'nip05', 
      'nip05PendingFetches', 'zapLoadStates', 'imageCache'
    ];

    this.#caches = CACHE_NAMES.reduce((acc, name) => ({
      ...acc,
      [name]: new BaseCache()
    }), {});

    this.viewStats = new Map();
    this.viewStates = new Map();

    this.#instance = this;
  }

  // プロフィール関連の委譲メソッド
  setProfile(pubkey, profile) { return this.profileCache.setProfile(pubkey, profile); }
  getProfile(pubkey) { return this.profileCache.get(pubkey); }
  subscribeToProfileUpdates(callback) { return this.profileCache.subscribe(callback); }

  // Zapイベント関連の委譲メソッド
  initializeZapView(viewId) { return this.zapEventCache.initializeView(viewId); }
  getZapEvents(viewId) { return this.zapEventCache.getEvents(viewId); }
  setZapEvents(viewId, events, maintainOrder) { return this.zapEventCache.setEvents(viewId, events, maintainOrder); }
  addZapEvent(viewId, event) { return this.zapEventCache.addEvent(viewId, event); }
  getZapViewState(viewId) { return this.zapEventCache.getViewState(viewId); }
  updateZapViewState(viewId, updates) { return this.zapEventCache.updateViewState(viewId, updates); }

  // リファレンス関連の委譲メソッド
  setReference(eventId, reference) { return this.referenceCache.set(eventId, reference); }
  getReference(eventId) { return this.referenceCache.get(eventId); }
  getOrFetchReference(eventId, fetchFn) { return this.referenceCache.getOrFetch(eventId, fetchFn); }

  // リファレンスコンポーネント関連の委譲メソッド
  getReferenceComponent(eventId) { return this.referenceCache.getComponent(eventId); }
  setReferenceComponent(eventId, html) { return this.referenceCache.setComponent(eventId, html); }

  // Stats関連のメソッドを更新
  getCachedStats(viewId, identifier) {
    return this.statsCache.getCached(viewId, identifier);
  }

  updateStatsCache(viewId, identifier, stats) {
    this.statsCache.setCached(viewId, identifier, stats);
    this.statsCache.updateViewStats(viewId, stats);
  }

  getViewStats(viewId) {
    return this.statsCache.getViewStats(viewId);
  }

  // キャッシュデータ処理メソッドを追加
  async processCachedData(viewId, config, renderCallback) {
    this.setRelayUrls(config.relayUrls);
    
    const cachedEvents = this.getZapEvents(viewId);
    const hasReferences = cachedEvents.some(event => this.getReference(event.id));
    
    const results = await Promise.all([
      this.getCachedStats(viewId, config.identifier),
      cachedEvents.length > 0 ? renderCallback(cachedEvents, viewId) : null
    ]);

    return {
      stats: results[0],
      hasEnoughCachedEvents: cachedEvents.length >= APP_CONFIG.INITIAL_LOAD_COUNT,
      hasReferences: hasReferences
    };
  }

  // デコード関連の委譲メソッド
  hasDecoded(key) { return this.decodedCache.hasDecoded(key); }
  setDecoded(key, value) { return this.decodedCache.setDecoded(key, value); }
  getDecoded(key) { return this.decodedCache.getDecoded(key); }

  // LoadState関連の委譲メソッド
  initializeLoadState(viewId) { return this.loadStateCache.initializeLoadState(viewId); }
  getLoadState(viewId) { return this.loadStateCache.getLoadState(viewId); }
  updateLoadState(viewId, updates) { return this.loadStateCache.updateLoadState(viewId, updates); }
  canLoadMore(viewId) { return this.loadStateCache.canLoadMore(viewId); }
  updateLoadProgress(viewId, count) { return this.loadStateCache.updateLoadProgress(viewId, count); }

  // ZapInfo関連の委譲メソッド
  setZapInfo(eventId, info) { return this.zapInfoCache.setZapInfo(eventId, info); }
  getZapInfo(eventId) { return this.zapInfoCache.getZapInfo(eventId); }
  clearZapInfo(eventId) { return this.zapInfoCache.clearZapInfo(eventId); }

  // 画像キャッシュ関連の委譲メソッド
  setImageCache(url, img) { return this.imageCache.setImage(url, img); }
  getImageCache(url) { return this.imageCache.getImage(url); }
  hasImageCache(url) { return this.imageCache.hasImage(url); }

  // View状態管理の委譲メソッド（統合版）
  getOrCreateViewState(viewId, defaultState = {}) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, { currentStats: null, ...defaultState });
    }
    return this.viewStates.get(viewId);
  }

  getViewState(viewId) {
    return this.getOrCreateViewState(viewId);
  }

  updateViewState(viewId, updates) {
    const currentState = this.getOrCreateViewState(viewId);
    this.viewStates.set(viewId, { ...currentState, ...updates });
    return this.viewStates.get(viewId);
  }

  // その他の汎用キャッシュメソッド
  setCacheItem(cacheName, key, value) {
    const cache = this.#caches[cacheName];
    if (cache) cache.set(key, value);
  }

  getCacheItem(cacheName, key) {
    const cache = this.#caches[cacheName];
    return cache ? cache.get(key) : null;
  }

  // グローバル設定
  setRelayUrls(urls) { this.#relayUrls = urls; }
  getRelayUrls() { return this.#relayUrls; }

  // クリーンアップ
  clearAll() {
    this.profileCache.clear();
    this.profileCache.clearSubscriptions();
    this.zapEventCache.clear();
    this.referenceCache.clear();
    this.referenceCache.clearPendingFetches();
    this.referenceCache.clearComponents();
    this.statsCache.clear();
    this.decodedCache.clear();
    this.loadStateCache.clear();
    this.zapInfoCache.clear();
    this.imageCache.clear();
    Object.values(this.#caches).forEach(cache => cache.clear());
    this.viewStats.clear();
    this.viewStates.clear();
  }

  // ...existing code for other methods...
}

export const cacheManager = new CacheManager();
