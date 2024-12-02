import { 
  renderZapListFromCache, 
  showNoZapsMessage 
} from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js";
import { ZAP_CONFIG as CONFIG, APP_CONFIG } from "./ZapConfig.js";  // APP_CONFIGを追加
import { statsManager } from "./StatsManager.js";
import { poolManager } from "./ZapPool.js";

class ZapSubscriptionManager {
  constructor() {
    this.viewStates = new Map();
    this.configStore = new Map();
  }

  getOrCreateViewState(viewId) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, {
        zapEventsCache: [],
        zapStatsCache: new Map(),
        isInitialFetchComplete: false,
        currentStats: null
      });
    }
    return this.viewStates.get(viewId);
  }

  setViewConfig(viewId, config) {
    this.configStore.set(viewId, config);
  }

  getViewConfig(viewId) {
    return this.configStore.get(viewId);
  }

  clearCache(viewId) {
    const state = this.getOrCreateViewState(viewId);
    state.zapEventsCache = [];
    state.currentStats = null;
  }

  async handleZapEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    console.log('[ZapManager] 受信したZapイベント:', event);
    
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      await this.updateEventReference(event, viewId);
      
      const isRealTime = event.created_at >= Math.floor(Date.now() / 1000) - 5;
      event.isRealTimeEvent = isRealTime;

      state.zapEventsCache.push(event);
      state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      console.log('[ZapManager] キャッシュ更新後の状態:', {
        totalEvents: state.zapEventsCache.length,
        isRealTime,
        eventId: event.id
      });

      await statsManager.handleZapEvent(event, state, viewId);
    } else {
      console.log('[ZapManager] 重複イベントをスキップ:', event.id);
    }
  }

  async updateEventReference(event, viewId) {
    const eTag = event.tags.find(tag => tag[0] === 'e');
    const config = this.getViewConfig(viewId);
    
    const identifier = config?.identifier || '';
    if (isEventIdentifier(identifier)) {
      return false;
    }

    if (eTag && config?.relayUrls) {
      try {
        const reference = await poolManager.fetchReference(config.relayUrls, eTag[1]);
        if (reference) {
          event.reference = reference;
          return true;
        }
      } catch (error) {
        console.error("Failed to fetch reference:", error);
      }
    }
    return false;
  }

  async updateEventReferenceBatch(events, viewId) {
    const config = this.getViewConfig(viewId);
    if (!config?.relayUrls) return;

    const identifier = config?.identifier || '';
    if (isEventIdentifier(identifier)) return;

    const eventIds = events
      .map(event => event.tags.find(tag => tag[0] === 'e')?.[1])
      .filter(Boolean);

    await Promise.all(
      eventIds.map(async (eventId) => {
        try {
          const reference = await poolManager.fetchReference(config.relayUrls, eventId);
          const event = events.find(e => e.tags.some(t => t[0] === 'e' && t[1] === eventId));
          if (event && reference) {
            event.reference = reference;
          }
        } catch (error) {
          console.error("Failed to fetch reference:", error);
        }
      })
    );
  }

  async initializeSubscriptions(config, viewId) {
    console.log('[ZapManager] サブスクリプション初期化開始:', { viewId, config });

    const decoded = decodeIdentifier(config.identifier);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    const state = this.getOrCreateViewState(viewId);
    state.isInitialFetchComplete = false;
    state.lastEventTime = null;
    state.isLoading = false;

    return new Promise((resolve) => {
      const events = [];
      poolManager.subscribeToZaps(viewId, config, decoded, {
        onevent: async (event) => {
          if (!state.zapEventsCache.some(e => e.id === event.id)) {
            await this.updateEventReference(event, viewId);
            events.push(event);
            if (!state.lastEventTime || event.created_at < state.lastEventTime) {
              state.lastEventTime = event.created_at;
            }
          }
        },
        oneose: async () => {
          if (events.length > 0) {
            state.zapEventsCache.push(...events);
            state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);
            for (const event of events) {
              await statsManager.handleZapEvent(event, state, viewId);
            }
            await renderZapListFromCache(state.zapEventsCache, viewId);
          }
          state.isInitialFetchComplete = true;
          if (state.zapEventsCache.length === 0) {
            showNoZapsMessage(viewId);
          }
          resolve();
        }
      });
    });
  }

  async loadMoreZaps(viewId) {
    const state = this.getOrCreateViewState(viewId);
    const config = this.getViewConfig(viewId);

    if (!config || state.isLoading || !state.lastEventTime) {
      console.log('[ZapManager] 追加ロードをスキップ:', { 
        hasConfig: !!config, 
        isLoading: state.isLoading, 
        lastEventTime: state.lastEventTime 
      });
      return 0;
    }

    try {
      state.isLoading = true;
      console.log('[ZapManager] 追加ロード開始:', {
        lastEventTime: state.lastEventTime,
        currentCacheSize: state.zapEventsCache.length,
        loadCount: APP_CONFIG.ADDITIONAL_LOAD_COUNT,
        viewId
      });

      const decoded = decodeIdentifier(config.identifier, state.lastEventTime);
      if (!decoded) return 0;

      let newEventsCount = 0;
      await new Promise((resolve) => {
        poolManager.subscribeToZaps(viewId, config, decoded, {
          onevent: async (event) => {
            if (event.created_at < state.lastEventTime) {
              await this.handleZapEvent(event, viewId);
              newEventsCount++;
              state.lastEventTime = event.created_at;
            }
          },
          oneose: async () => {
            if (newEventsCount > 0) {
              await renderZapListFromCache(state.zapEventsCache, viewId);
            }
            resolve();
          }
        });
      });

      console.log('[ZapManager] 追加ロード完了:', {
        newEventsCount,
        totalCacheSize: state.zapEventsCache.length,
        lastEventTime: state.lastEventTime
      });

      return newEventsCount;
    } catch (error) {
      console.error('[ZapManager] 追加ロード失敗:', error);
      return 0;
    } finally {
      state.isLoading = false;
    }
  }

  setupInfiniteScroll(viewId) {
    const dialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (!dialog) return;

    const list = dialog.shadowRoot.querySelector('.dialog-zap-list');
    if (!list) return;

    let trigger = list.querySelector('.load-more-trigger');
    if (!trigger) {
      trigger = document.createElement('div');
      trigger.className = 'load-more-trigger';
      list.appendChild(trigger);
    }

    console.log('[ZapManager] 無限スクロール設定:', { viewId });

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          console.log('[ZapManager] スクロールトリガー検知:', {
            intersectionRatio: entry.intersectionRatio
          });
          
          const loadedCount = await this.loadMoreZaps(viewId);
          if (loadedCount === 0) {
            console.log('[ZapManager] これ以上のデータなし');
            observer.unobserve(trigger);
            trigger.remove();
          }
        }
      },
      { 
        root: list,
        rootMargin: '500px',
        threshold: [0]
      }
    );

    observer.observe(trigger);
  }
}

const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
