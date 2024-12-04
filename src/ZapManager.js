import { 
  showNoZapsMessage
} from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js";
import { ZAP_CONFIG as CONFIG, APP_CONFIG } from "./AppSettings.js";  // DIALOG_CONFIGを追加
import { statsManager } from "./StatsManager.js";
import { eventPool } from "./EventPool.js";  // パスを更新
import { cacheManager } from "./CacheManager.js";
import { profilePool } from "./ProfilePool.js"; // 追加: ProfilePoolからprofilePoolをインポート

class ZapSubscriptionManager {
  constructor() {
    this.configStore = new Map();
    this.observers = new Map();
  }

  setZapListUI(zapListUI) {
    this.zapListUI = zapListUI;
  }

  setViewConfig(viewId, config) {
    this.configStore.set(viewId, config);
  }

  getViewConfig(viewId) {
    return this.configStore.get(viewId);
  }

  // コア機能
  async processZapEvent(event, viewId, shouldUpdateUI = true) {
    try {
      const [hasReference, profiles] = await Promise.all([
        this._processEventReference(event, viewId),
        profilePool.fetchProfiles([event.pubkey])
      ]);

      if (shouldUpdateUI && this.zapListUI) {
        await this.zapListUI.appendZap(event);
      }

      await this._processEventMetadata(event, viewId);

      if (hasReference && shouldUpdateUI && this.zapListUI && event.reference) {
        this.zapListUI.updateZapReference(event);
      }

      return true;
    } catch (error) {
      console.error("Zap処理エラー:", error);
      return false;
    }
  }

  async handleZapEvent(event, viewId) {
    if (!cacheManager.addZapEvent(viewId, event)) return;
    await this.processZapEvent(event, viewId);
  }

  async _processEventReference(event, viewId) {
    const config = this.getViewConfig(viewId);
    if (!this._isValidReferenceConfig(config)) return false;

    const reference = await this._fetchEventReference(event, config);
    if (reference) {
      event.reference = reference;
      return true;
    }
    return false;
  }

  async _processEventMetadata(event, viewId) {
    await Promise.all([
      statsManager.handleZapEvent(event, viewId),
      profilePool.verifyNip05Async(event.pubkey)
    ]);
  }

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
          return await eventPool.fetchATagReference(config.relayUrls, aTag[1]);
        }

        const eTag = event.tags.find(t => Array.isArray(t) && t[0] === 'e');
        if (eTag?.[1] && /^[0-9a-f]{64}$/.test(eTag[1].toLowerCase())) {
          return await eventPool.fetchReference(config.relayUrls, eTag[1]);
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

    // イベントごとにリファレンス情報を取得
    const fetchPromises = events.map(event => this.updateEventReference(event, viewId));
    await Promise.allSettled(fetchPromises);
  }

  // initializeSubscriptionsメソッドを最適化
  async initializeSubscriptions(config, viewId) {
    const decoded = decodeIdentifier(config.identifier);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    this._initializeLoadState(viewId);
    
    const { batchEvents, lastEventTime } = await this._collectInitialEvents(viewId, config, decoded);
    
    if (batchEvents?.length > 0) {
      await this._processBatchEvents(batchEvents, viewId);
    }
    
    await this.finalizeInitialization(viewId, lastEventTime);
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

  async _processBatchEvents(events, viewId) {
    if (!events?.length) return;

    // イベントを時系列順にソート
    events.sort((a, b) => b.created_at - a.created_at);
    
    // キャッシュに追加
    events.forEach(event => cacheManager.addZapEvent(viewId, event));

    const pubkeys = [...new Set(events.map(event => event.pubkey))];
    
    // プロファイル情報とリファレンス情報を並列で取得
    await Promise.all([
      profilePool.fetchProfiles(pubkeys),
      this.updateEventReferenceBatch(events, viewId),
      ...events.map(event => statsManager.handleZapEvent(event, viewId)),
      ...events.map(event => profilePool.verifyNip05Async(event.pubkey))
    ]);

    // まとめてUIを更新
    if (this.zapListUI) {
      // まずイベントリストを更新
      await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
      
      // その後でリファレンス情報を更新
      const eventsWithRefs = events.filter(event => event.reference);
      if (eventsWithRefs.length > 0) {
        eventsWithRefs.forEach(event => {
          this.zapListUI.updateZapReference(event);
        });
      }
    }
  }

  async loadMoreZaps(viewId) {
    const state = cacheManager.getLoadState(viewId);
    const config = this.getViewConfig(viewId);

    if (!this._canLoadMore(state, config)) return 0;

    state.isLoading = true;
    try {
      return await this._executeLoadMore(viewId, state, config);
    } finally {
      state.isLoading = false;
    }
  }

  setupInfiniteScroll(viewId) {
    this._cleanupInfiniteScroll(viewId);
    const list = this._getListElement(viewId);
    if (!list) return;

    const trigger = document.createElement('div');
    trigger.className = 'load-more-trigger';
    list.appendChild(trigger);

    const observer = new IntersectionObserver(
      this._createIntersectionCallback(viewId),
      {
        root: list,
        rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
        threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
      }
    );

    observer.observe(trigger);
    this.observers.set(viewId, observer);
  }

  _cleanupInfiniteScroll(viewId) {
    const observer = this.observers.get(viewId);
    if (observer) {
      observer.disconnect();
      const list = this._getListElement(viewId);
      const trigger = list?.querySelector('.load-more-trigger');
      if (trigger) {
        trigger.remove();
      }
      this.observers.delete(viewId);
    }
  }

  _createIntersectionCallback(viewId) {
    let isLoading = false;
    let timeoutId = null;

    return async (entries) => {
      if (!entries[0].isIntersecting || isLoading) return;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(async () => {
        try {
          isLoading = true;
          const loadedCount = await this.loadMoreZaps(viewId);
          if (loadedCount === 0) {
            this._cleanupInfiniteScroll(viewId);
          }
        } finally {
          isLoading = false;
        }
      }, 300);
    };
  }

  _getListElement(viewId) {
    return document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)
      ?.shadowRoot?.querySelector('.dialog-zap-list');
  }

  // 新しいメソッド: 残りのリファレンス情報を更新
  async updateRemainingReferences(viewId) {
    const allEvents = cacheManager.getZapEvents(viewId);
    const eventsNeedingRefs = allEvents.filter(event => !event.reference);
    
    if (eventsNeedingRefs.length > 0) {
      this.updateEventReferenceBatch(eventsNeedingRefs, viewId).then(() => {
        eventsNeedingRefs.forEach(event => {
          if (event.reference && this.zapListUI) {
            this.zapListUI.updateZapReference(event);
          }
        });
      });
    }
  }

  // バッチ処理の最適化
  async processBatch(events, viewId) {
    try {
      const pubkeys = [...new Set(events.map(event => event.pubkey))];
      const [, sortedEvents] = await Promise.all([
        profilePool.fetchProfiles(pubkeys),
        Promise.resolve(events.sort((a, b) => b.created_at - a.created_at))
      ]);

      sortedEvents.forEach(event => cacheManager.addZapEvent(viewId, event));

      if (this.zapListUI) {
        await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
      }

      await Promise.all([
        this.updateEventReferenceBatch(sortedEvents, viewId),
        ...sortedEvents.flatMap(event => [
          statsManager.handleZapEvent(event, viewId),
          profilePool.verifyNip05Async(event.pubkey)
        ])
      ]);

      this.updateUIReferences(sortedEvents);
    } catch (error) {
      console.error("バッチ処理エラー:", error);
    }
  }

  async finalizeInitialization(viewId, lastEventTime) {
    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: true,
      lastEventTime
    });

    const cachedEvents = cacheManager.getZapEvents(viewId);
    if (cachedEvents.length === 0) {
      showNoZapsMessage(viewId);
    } else if (cachedEvents.length >= APP_CONFIG.INITIAL_LOAD_COUNT) {
      this.setupInfiniteScroll(viewId);
    }
  }

  _canLoadMore(state, config) {
    return config && !state.isLoading && state.lastEventTime;
  }

  async _executeLoadMore(viewId, state, config) {
    const decoded = decodeIdentifier(config.identifier, state.lastEventTime);
    if (!decoded) return 0;

    const batchEvents = [];
    const batchSize = APP_CONFIG.BATCH_SIZE || 20;

    try {
      await this._collectEvents(viewId, config, decoded, batchEvents, batchSize, state);
      if (batchEvents.length > 0) {
        await this._processBatchEvents(batchEvents, viewId);
      }
      return batchEvents.length;
    } catch (error) {
      console.error('Load more events failed:', error);
      return 0;
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

  _initializeLoadState(viewId) {
    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false
    });
  }

  _setupBufferInterval(batchEvents, viewId) {
    return setInterval(() => {
      if (batchEvents.length > 0) {
        const eventsToProcess = batchEvents.splice(0);
        if (this.zapListUI) {
          this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId))
            .catch(console.error);
        }
      }
    }, 500);
  }

  _handleInitialEvent(event, batchEvents, lastEventTime, viewId) {
    const currentLastTime = Math.min(lastEventTime || event.created_at, event.created_at);
    
    if (cacheManager.addZapEvent(viewId, event)) {
      batchEvents.push(event);
      
      // リファレンス情報の更新のみを担当
      this.updateEventReference(event, viewId).then(hasReference => {
        if (hasReference && this.zapListUI && event.reference) {
          this.zapListUI.updateZapReference(event);
        }
      });

      if (batchEvents.length >= (APP_CONFIG.BATCH_SIZE || 5)) {
        const eventsToProcess = batchEvents.splice(0);
        if (this.zapListUI) {
          this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId))
            .catch(console.error);
        }
      }
    }
    
    return currentLastTime;
  }

  updateUIReferences(events) {
    if (!this.zapListUI) return;
    events.forEach(event => {
      if (event.reference) {
        this.zapListUI.updateZapReference(event);
      }
    });
  }

  _isValidReferenceConfig(config) {
    return config?.relayUrls?.length && !isEventIdentifier(config?.identifier || '');
  }
}

// ZapSubscriptionManager を初期化する際に zapListUI を設定
const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
