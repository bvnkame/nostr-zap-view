import { decodeIdentifier, isEventIdentifier } from "./utils.js";
import { ZAP_CONFIG as CONFIG, APP_CONFIG } from "./AppSettings.js";
import { statsManager } from "./StatsManager.js";
import { eventPool } from "./EventPool.js";
import { cacheManager } from "./CacheManager.js";
import { profilePool } from "./ProfilePool.js";

class ZapSubscriptionManager {
  constructor() {
    this.viewConfigs = new Map();
    this.configStore = new Map();
    this.observers = new Map();
  }

  // 基本設定メソッド
  setZapListUI(zapListUI) {
    this.zapListUI = zapListUI;
  }

  setViewConfig(viewId, config) {
    this.viewConfigs.set(viewId, config);
    cacheManager.initializeZapView(viewId);
  }

  getViewConfig(viewId) {
    return this.viewConfigs.get(viewId);
  }

  // イベント参照関連メソッド
  async updateEventReference(event, viewId) {
    try {
      const config = this.getViewConfig(viewId);
      
      if (!config?.relayUrls?.length) {
        console.warn("No relay URLs configured for reference fetch");
        return false;
      }

      const identifier = config?.identifier || '';
      if (isEventIdentifier(identifier)) return false;

      const reference = await this._fetchEventReference(event, config);
      if (reference) {
        event.reference = reference;
        return true;
      }
      return false;

    } catch (error) {
      console.error("Reference fetch failed:", error, { eventId: event.id });
      return false;
    }
  }

  async _fetchEventReference(event, config) {
    const fetchFn = async () => {
      if (!event?.tags || !Array.isArray(event.tags)) {
        console.warn("Invalid event tags:", event);
        return null;
      }

      try {
        const aTag = event.tags.find(t => Array.isArray(t) && t[0] === 'a');
        if (aTag?.[1]) {
          return await eventPool.fetchReference(config.relayUrls, event, 'a');
        }

        const eTag = event.tags.find(t => Array.isArray(t) && t[0] === 'e');
        if (eTag?.[1] && /^[0-9a-f]{64}$/.test(eTag[1].toLowerCase())) {
          return await eventPool.fetchReference(config.relayUrls, event, 'e');
        }

        return null;
      } catch (error) {
        console.warn("Failed to fetch reference:", error);
        return null;
      }
    };

    try {
      return await cacheManager.getOrFetchReference(event.id, fetchFn);
    } catch (error) {
      console.error("Reference fetch failed:", error, { event });
      return null;
    }
  }

  async updateEventReferenceBatch(events, viewId) {
    const config = this.getViewConfig(viewId);
    if (!config?.relayUrls?.length) return;

    const identifier = config?.identifier || '';
    if (isEventIdentifier(identifier)) return;

    const fetchPromises = events.map(event => this.updateEventReference(event, viewId));
    await Promise.allSettled(fetchPromises);
  }

  updateUIReferences(events) {
    if (!this.zapListUI) return;
    events.forEach(event => {
      if (event.reference) {
        this.zapListUI.updateZapReference(event);
      }
    });
  }

  // 初期化関連メソッド
  async initializeSubscriptions(config, viewId) {
    try {
      console.debug("Initializing subscription:", { config, viewId });

      if (!this._isValidFilter(config)) {
        console.warn("Invalid filter configuration:", config);
        throw new Error("無効なフィルター設定");
      }

      const decoded = decodeIdentifier(config.identifier);
      if (!decoded) {
        console.warn("Failed to decode identifier:", config.identifier);
        throw new Error(CONFIG.ERRORS.DECODE_FAILED);
      }

      console.debug("Decoded identifier:", decoded);

      this._initializeLoadState(viewId);
      
      const { batchEvents, lastEventTime } = await this._collectInitialEvents(viewId, config, decoded);
      
      if (batchEvents?.length > 0) {
        await this._processBatchEvents(batchEvents, viewId);
      }
      
      await this.finalizeInitialization(viewId, lastEventTime);
    } catch (error) {
      console.error("サブスクリプション初期化エラー:", error);
      throw error;
    }
  }

  async finalizeInitialization(viewId, lastEventTime) {
    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: true,
      lastEventTime
    });

    const cachedEvents = cacheManager.getZapEvents(viewId);
    if (cachedEvents.length === 0) {
      if (this.zapListUI) {
        await this.zapListUI.showNoZapsMessage();
        console.debug("No cached events found:", { viewId });
      }
    } else if (cachedEvents.length >= APP_CONFIG.INITIAL_LOAD_COUNT) {
      console.debug("Cached events found:", { count: cachedEvents.length, viewId });
      this.setupInfiniteScroll(viewId);
    }
  }

  _initializeLoadState(viewId) {
    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false
    });
  }

  _isValidFilter(config) {
    return config && 
           config.relayUrls && 
           Array.isArray(config.relayUrls) && 
           config.relayUrls.length > 0 && 
           config.identifier;
  }

  // 無限スクロール関連メソッド
  setupInfiniteScroll(viewId) {
    try {
      this._cleanupInfiniteScroll(viewId);
      const list = this._getListElement(viewId);
      if (!list) return;

      const trigger = this._createLoadTrigger();
      list.appendChild(trigger);
      this._observeLoadTrigger(trigger, viewId, list);
    } catch (error) {
      console.error('Failed to setup infinite scroll:', error);
    }
  }

  _createLoadTrigger() {
    const trigger = document.createElement('div');
    trigger.className = 'load-more-trigger';
    trigger.style.cssText = 'height: 10px; margin-top: 20px;';
    return trigger;
  }

  _observeLoadTrigger(trigger, viewId, list) {
    const observer = new IntersectionObserver(
      entries => this._handleIntersection(entries[0], viewId),
      {
        root: list,
        rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
        threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
      }
    );

    observer.observe(trigger);
    this.observers.set(viewId, observer);
  }

  async _handleIntersection(entry, viewId) {
    console.debug('Intersection detected:', { 
      isIntersecting: entry.isIntersecting, 
      viewId 
    });

    if (!entry.isIntersecting) return;

    const state = cacheManager.getLoadState(viewId);
    console.debug('Load state:', { 
      isLoading: state.isLoading, 
      lastEventTime: state.lastEventTime, 
      viewId 
    });

    if (state.isLoading) {
      console.debug('Already loading, will retry later:', { viewId });
      // ロード中の場合は1秒後に再試行
      setTimeout(() => {
        if (entry.isIntersecting) {
          this._handleIntersection(entry, viewId);
        }
      }, 1000);
      return;
    }

    this.loadMoreZaps(viewId).then(count => {
      console.debug('Load more completed:', { count, viewId });
      if (count === 0) {
        console.debug('No more zaps to load, cleaning up:', { viewId });
        this._cleanupInfiniteScroll(viewId);
      }
    }).catch(error => {
      console.error('Infinite scroll load failed:', error);
      this._cleanupInfiniteScroll(viewId);
    });
  }

  _cleanupInfiniteScroll(viewId) {
    const observer = this.observers.get(viewId);
    if (!observer) return;

    observer.disconnect();
    const list = this._getListElement(viewId);
    list?.querySelector('.load-more-trigger')?.remove();
    this.observers.delete(viewId);
  }

  _getListElement(viewId) {
    return document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)
      ?.shadowRoot?.querySelector('.dialog-zap-list');
  }

  // イベント処理関連メソッド
  async loadMoreZaps(viewId) {
    const state = cacheManager.getLoadState(viewId);
    const config = this.getViewConfig(viewId);

    console.debug('Loading more zaps:', { 
      viewId, 
      lastEventTime: state.lastEventTime,
      isLoading: state.isLoading,
      hasConfig: !!config 
    });

    if (!this._canLoadMore(state, config)) {
      console.warn('Cannot load more:', { 
        state: { 
          isLoading: state.isLoading, 
          lastEventTime: state.lastEventTime 
        }, 
        hasConfig: !!config 
      });
      return 0;
    }

    state.isLoading = true;
    try {
      const loadedCount = await this._executeLoadMore(viewId, state, config);
      console.debug('Loaded more zaps:', { loadedCount, viewId });
      
      if (loadedCount > 0) {
        const events = cacheManager.getZapEvents(viewId).slice(-loadedCount);
        await this.updateEventReferenceBatch(events, viewId);
        this.updateUIReferences(events);
      }
      return loadedCount;
    } finally {
      state.isLoading = false;
    }
  }

  async _executeLoadMore(viewId, state, config) {
    const decoded = decodeIdentifier(config.identifier, state.lastEventTime);
    if (!decoded) {
      console.warn('Failed to decode identifier for load more:', { 
        identifier: config.identifier, 
        lastEventTime: state.lastEventTime 
      });
      return 0;
    }

    console.debug('Executing load more:', { 
      viewId, 
      lastEventTime: state.lastEventTime,
      decodedIdentifier: decoded 
    });

    const batchEvents = [];
    const loadTimeout = setTimeout(() => {
      console.warn('Load timeout reached:', { 
        batchEventsCount: batchEvents.length, 
        viewId 
      });
      if (batchEvents.length === 0) {
        this._cleanupInfiniteScroll(viewId);
      }
    }, APP_CONFIG.LOAD_TIMEOUT);

    try {
      await this._collectEvents(viewId, config, decoded, batchEvents, APP_CONFIG.ADDITIONAL_LOAD_COUNT, state);
      console.debug('Collected events:', { 
        count: batchEvents.length, 
        viewId 
      });

      if (batchEvents.length > 0) {
        await this._processBatchEvents(batchEvents, viewId);
      }
      return batchEvents.length;
    } catch (error) {
      console.error('Load more events failed:', error);
      return 0;
    } finally {
      clearTimeout(loadTimeout);
    }
  }

  async _collectEvents(viewId, config, decoded, batchEvents, batchSize, state) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Load timeout')), 
        APP_CONFIG.LOAD_TIMEOUT || 10000);

      eventPool.subscribeToZaps(viewId, config, decoded, {
        onevent: (event) => {
          if (event.created_at < state.lastEventTime) {
            batchEvents.push(event);
            state.lastEventTime = Math.min(state.lastEventTime, event.created_at);
            
            if (batchEvents.length >= batchSize) {
              clearTimeout(timeout);
              resolve();
            }
          }
        },
        oneose: () => {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  async _collectInitialEvents(viewId, config, decoded) {
    const batchEvents = [];
    let lastEventTime = null;
    
    return new Promise((resolve) => {
      const bufferInterval = this._setupBufferInterval(batchEvents, viewId);
      
      eventPool.subscribeToZaps(viewId, config, decoded, {
        onevent: (event) => {
          const currentLastTime = this._handleInitialEvent(event, batchEvents, lastEventTime, viewId);
          if (currentLastTime !== null) {
            lastEventTime = currentLastTime;
          }
        },
        oneose: () => {
          clearInterval(bufferInterval);
          resolve({ batchEvents: [...batchEvents], lastEventTime });
        }
      });
    });
  }

  _handleInitialEvent(event, batchEvents, lastEventTime, viewId) {
    const currentLastTime = Math.min(lastEventTime || event.created_at, event.created_at);
    
    if (cacheManager.addZapEvent(viewId, event)) {
      batchEvents.push(event);
      
      this.updateEventReference(event, viewId).then(hasReference => {
        if (hasReference && this.zapListUI && event.reference) {
          this.zapListUI.updateZapReference(event);
        }
      });

      // リアルタイムZapイベントの場合のみ統計情報を更新、設定を渡す
      if (event.isRealTimeEvent) {
        const config = this.getViewConfig(viewId);
        statsManager.handleZapEvent(event, viewId, config?.identifier);

        // すぐにUIを更新
        if (this.zapListUI) {
          this.zapListUI.prependZap(event).catch(console.error);
        }
      }

      if (batchEvents.length >= (APP_CONFIG.BATCH_SIZE || 5)) {
        if (this.zapListUI) {
          this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId))
            .catch(console.error);
        }
      }
    }
    
    return currentLastTime;
  }

  // UI更新関連メソッド
  async _processBatchEvents(events, viewId) {
    if (!events?.length) return;

    events.sort((a, b) => b.created_at - a.created_at);
    events.forEach(event => cacheManager.addZapEvent(viewId, event));

    try {
      await Promise.all([
        profilePool.processBatchProfiles(events)
        // statsManager.handleZapEventの呼び出しを削除
      ]);
    } catch (error) {
      console.warn('Profile processing failed:', error);
    }

    await this._updateUI(events, viewId);
  }

  async _updateUI(_events, viewId) {
    if (!this.zapListUI) return;
    await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
  }

  // ユーティリティメソッド
  _setupBufferInterval(batchEvents, viewId) {
    return setInterval(() => {
      if (batchEvents.length > 0) {
        if (this.zapListUI) {
          this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId))
            .catch(console.error);
        }
      }
    }, 500);
  }

  _canLoadMore(state, config) {
    const canLoad = config && !state.isLoading && state.lastEventTime;
    console.debug('Can load more check:', { 
      hasConfig: !!config, 
      isLoading: state?.isLoading, 
      lastEventTime: state?.lastEventTime,
      canLoad 
    });
    return canLoad;
  }
}

const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
