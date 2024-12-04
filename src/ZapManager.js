import { 
  renderZapListFromCache, 
  showNoZapsMessage
} from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js";
import { ZAP_CONFIG as CONFIG, APP_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";  // DIALOG_CONFIGを追加
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

  // イベント処理を共通化した新しいメソッド
  async processZapEvent(event, viewId, shouldUpdateUI = true) {
    try {
      // referenceの取得とプロフィール処理を並行実行
      const [referenceResult, profileResult] = await Promise.all([
        this.updateEventReference(event, viewId),
        statsManager.handleZapEvent(event, viewId)
      ]);

      if (shouldUpdateUI && this.zapListUI) {
        const events = cacheManager.getZapEvents(viewId);
        // イベントを日付の降順でソート
        events.sort((a, b) => b.created_at - a.created_at);
        await this.zapListUI.appendZap(event);
      }

      // NIP-05検証
      await profilePool.verifyNip05Async(event.pubkey);
      
      return true;
    } catch (error) {
      console.error("Failed to process zap event:", error);
      return false;
    }
  }

  async handleZapEvent(event, viewId) {
    if (!cacheManager.addZapEvent(viewId, event)) return;
    await this.processZapEvent(event, viewId);
  }

  async updateEventReference(event, viewId) {
    try {
      const aTag = event.tags.find(tag => tag[0] === 'a');
      const eTag = event.tags.find(tag => tag[0] === 'e');
      const config = this.getViewConfig(viewId);
      
      if (!config?.relayUrls?.length) {
        console.warn("No relay URLs configured for reference fetch");
        return false;
      }

      const identifier = config?.identifier || '';
      if (isEventIdentifier(identifier)) return false;

      let reference = null;
      
      if (aTag) {
        try {
          reference = await eventPool.fetchATagReference(config.relayUrls, aTag[1]);
        } catch (error) {
          console.warn("A-tag reference fetch failed:", aTag[1], error);
        }
      }
      
      if (!reference && eTag) {
        try {
          // hex形式の確認を追加
          const eventId = eTag[1].toLowerCase();
          if (/^[0-9a-f]{64}$/.test(eventId)) {
            reference = await eventPool.fetchReference(config.relayUrls, eventId);
          }
        } catch (error) {
          console.warn("E-tag reference fetch failed:", eTag[1], error);
        }
      }

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

  async updateEventReferenceBatch(events, viewId) {
    const config = this.getViewConfig(viewId);
    if (!config?.relayUrls?.length) return;

    const identifier = config?.identifier || '';
    if (isEventIdentifier(identifier)) return;

    // aタグとeタグの参照を分けて処理
    const aTagRefs = new Map();
    const eTagRefs = new Map();

    events.forEach(event => {
      const aTag = event.tags.find(tag => tag[0] === 'a');
      const eTag = event.tags.find(tag => tag[0] === 'e');

      if (aTag?.[1]) {
        aTagRefs.set(aTag[1], event);
      }
      
      if (eTag?.[1]) {
        const eventId = eTag[1].toLowerCase();
        if (/^[0-9a-f]{64}$/.test(eventId)) {
          eTagRefs.set(eventId, event);
        }
      }
    });

    try {
      // a-tagの参照を取得
      if (aTagRefs.size > 0) {
        const aTagResults = await Promise.allSettled(
          Array.from(aTagRefs.keys()).map(async (aTagValue) => {
            const result = await eventPool.fetchATagReference(config.relayUrls, aTagValue);
            return { aTagValue, result };
          })
        );

        aTagResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value.result) {
            const event = aTagRefs.get(result.value.aTagValue);
            if (event) event.reference = result.value.result;
          }
        });
      }

      // e-tagの参照を取得
      if (eTagRefs.size > 0) {
        const eTagResults = await Promise.allSettled(
          Array.from(eTagRefs.keys()).map(async (eventId) => {
            const result = await eventPool.fetchReference(config.relayUrls, eventId);
            return { eventId, result };
          })
        );

        eTagResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value.result) {
            const event = eTagRefs.get(result.value.eventId);
            if (event) event.reference = result.value.result;
          }
        });
      }

    } catch (error) {
      console.error("Batch reference fetch failed:", error);
    }
  }

  async initializeSubscriptions(config, viewId) {
    const decoded = decodeIdentifier(config.identifier);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false
    });

    return new Promise((resolve) => {
      let lastEventTime = null;

      const handleEvent = async (event) => {
        lastEventTime = Math.min(lastEventTime || event.created_at, event.created_at);
        if (cacheManager.addZapEvent(viewId, event)) {
          await this.processZapEvent(event, viewId, false); // UIの更新を一時的に無効化

          // イベントの取得後、ソートしてからまとめて表示
          const events = cacheManager.getZapEvents(viewId);
          events.sort((a, b) => b.created_at - a.created_at);
          try {
            renderZapListFromCache(events, viewId);
          } catch (error) {
            console.error('Failed to render zap list:', error);
          }
        }
      };

      eventPool.subscribeToZaps(viewId, config, decoded, {
        onevent: handleEvent,
        oneose: () => {
          this.finalizeInitialization(viewId, lastEventTime);
          resolve();
        }
      });
    });
  }

  finalizeInitialization(viewId, lastEventTime) {
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

  // loadMoreZaps method with improved error handling
  async loadMoreZaps(viewId) {
    const state = cacheManager.getLoadState(viewId);
    const config = this.getViewConfig(viewId);

    if (!this.canLoadMore(state, config)) return 0;

    try {
      state.isLoading = true;
      return await this.executeLoadMore(viewId, state, config);
    } catch (error) {
      console.error('[ZapManager] 追加ロード失敗:', error);
      return 0;
    } finally {
      state.isLoading = false;
    }
  }

  canLoadMore(state, config) {
    return config && !state.isLoading && state.lastEventTime;
  }

  async executeLoadMore(viewId, state, config) {
    const decoded = decodeIdentifier(config.identifier, state.lastEventTime);
    if (!decoded) return 0;

    let newEventsCount = 0;
    const newEvents = [];

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Load timeout'));
        }, APP_CONFIG.LOAD_TIMEOUT || 10000);

        eventPool.subscribeToZaps(viewId, config, decoded, {
          onevent: async (event) => {
            if (event.created_at < state.lastEventTime) {
              try {
                // イベントを一時配列に保存
                newEvents.push(event);
                newEventsCount++;
                state.lastEventTime = Math.min(state.lastEventTime, event.created_at);
              } catch (error) {
                console.error('[ZapManager] イベント処理エラー:', error);
              }
            }
          },
          oneose: () => {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // すべてのイベントを取得後、まとめて処理
      if (newEventsCount > 0) {
        // 新しいイベントをソート
        newEvents.sort((a, b) => b.created_at - a.created_at);

        // リファレンス情報を一括取得
        await this.updateEventReferenceBatch(newEvents, viewId);

        // イベントを一括で追加
        for (const event of newEvents) {
          await this.handleZapEvent(event, viewId);
        }

        // キャッシュ全体を再ソート
        const allEvents = cacheManager.getZapEvents(viewId);
        allEvents.sort((a, b) => b.created_at - a.created_at);

        // UIを一括更新
        try {
          renderZapListFromCache(allEvents, viewId);
        } catch (error) {
          console.error('[ZapManager] UIの更新に失敗:', error);
        }
      }

      console.log('[ZapManager] 追加ロード完了:', {
        newEventsCount,
        totalCacheSize: cacheManager.getZapEvents(viewId).length,
        lastEventTime: state.lastEventTime
      });

      return newEventsCount;

    } catch (error) {
      console.error('[ZapManager] 追加ロード処理エラー:', error);
      return 0;
    }
  }

  // インフィニットスクロールの処理を改善
  setupInfiniteScroll(viewId) {
    const list = this.getListElement(viewId);
    if (!list || this.observers?.get(viewId)) return;

    const trigger = this.createScrollTrigger();
    list.appendChild(trigger);

    const observer = this.createIntersectionObserver(viewId, trigger, list);
    observer.observe(trigger);
    this.observers.set(viewId, observer);
  }

  getListElement(viewId) {
    const dialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    return dialog?.shadowRoot?.querySelector('.dialog-zap-list');
  }

  createScrollTrigger() {
    const trigger = document.createElement('div');
    trigger.className = 'load-more-trigger';
    return trigger;
  }

  createIntersectionObserver(viewId, trigger, list) {
    let isLoading = false;
    let debounceTimer = null;

    return new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting || isLoading) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (isLoading) return; // 二重チェック
          
          try {
            isLoading = true;
            const loadedCount = await this.loadMoreZaps(viewId);
            
            if (loadedCount === 0) {
              this.cleanupInfiniteScroll(viewId, trigger);
            }
          } catch (error) {
            console.error('[ZapManager] 追加ロード実行エラー:', error);
          } finally {
            isLoading = false;
          }
        }, 300); // デバウンス時間を増やして安定性を向上
      },
      {
        root: list,
        rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
        threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
      }
    );
  }

  cleanupInfiniteScroll(viewId, trigger) {
    const observer = this.observers.get(viewId);
    if (observer) {
      observer.disconnect();
      trigger.remove();
      this.observers.delete(viewId);
    }
  }
}

// ZapSubscriptionManager を初期化する際に zapListUI を設定
const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
