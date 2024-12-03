import { 
  renderZapListFromCache, 
  showNoZapsMessage 
} from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js";
import { ZAP_CONFIG as CONFIG, APP_CONFIG } from "./AppSettings.js";
import { statsManager } from "./StatsManager.js";
import { poolManager } from "./ZapPool.js";
import { cacheManager } from "./CacheManager.js";
import { profileManager } from "./ProfileManager.js"; // 追加: ProfileManagerからprofileManagerをインポート

class ZapSubscriptionManager {
  constructor() {
    this.configStore = new Map();
    this.observers = new Map();
  }

  setViewConfig(viewId, config) {
    this.configStore.set(viewId, config);
  }

  getViewConfig(viewId) {
    return this.configStore.get(viewId);
  }

  async handleZapEvent(event, viewId) {
    if (cacheManager.addZapEvent(viewId, event)) {
      // reference取得とプロフィール取得を並行して実行
      const [referencePromise, profilePromise] = [
        this.updateEventReference(event, viewId),
        statsManager.handleZapEvent(event, viewId)
      ];

      // UIの即時更新（初期表示）
      const events = cacheManager.getZapEvents(viewId);
      await renderZapListFromCache(events, viewId);

      // バックグラウンドで両方の処理を完了
      Promise.all([referencePromise, profilePromise])
        .then(() => {
          // 両方の情報が揃った後で再度UIを更新
          renderZapListFromCache(cacheManager.getZapEvents(viewId), viewId);
        })
        .catch(console.error);
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
        console.log("Fetching reference for event:", eTag[1]); // Add: コンソールログを追加
        const reference = await poolManager.fetchReference(config.relayUrls, eTag[1]);
        if (reference) {
          event.reference = reference;
          console.log("Reference fetched:", reference); // Add: コンソールログを追加
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

    cacheManager.updateLoadState(viewId, {
      isInitialFetchComplete: false,
      lastEventTime: null,
      isLoading: false
    });

    return new Promise((resolve) => {
      const events = [];
      let lastEventTime = null;

      poolManager.subscribeToZaps(viewId, config, decoded, {
        onevent: async (event) => {
          if (!lastEventTime || event.created_at < lastEventTime) {
            lastEventTime = event.created_at;
          }
          
          // 1. まずZapイベントをキャッシュに追加し即時表示
          if (cacheManager.addZapEvent(viewId, event)) {
            events.push(event);
            renderZapListFromCache(cacheManager.getZapEvents(viewId), viewId);

            // 2. reference情報の非同期取得を開始
            this.updateEventReference(event, viewId)
              .then(() => {
                renderZapListFromCache(cacheManager.getZapEvents(viewId), viewId);
              });

            // 3. プロフィール情報の非同期取得を開始
            statsManager.handleZapEvent(event, viewId)
              .then(() => {
                renderZapListFromCache(cacheManager.getZapEvents(viewId), viewId);
                
                // 4. プロフィールに基づくNIP-05検証を開始
                return profileManager.verifyNip05Async(event.pubkey);
              })
              .then(() => {
                renderZapListFromCache(cacheManager.getZapEvents(viewId), viewId);
              })
              .catch(console.error);
          }
        },
        oneose: () => {
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

          resolve();
        }
      });
    });
  }

  async loadMoreZaps(viewId) {
    const state = cacheManager.getLoadState(viewId);
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
        currentCacheSize: cacheManager.getZapEvents(viewId).length,
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
              // リファレンス情報を先に取得してからイベントを処理
              await this.updateEventReference(event, viewId);
              await this.handleZapEvent(event, viewId);
              newEventsCount++;
              state.lastEventTime = event.created_at;
            }
          },
          oneose: resolve
        });
      });

      console.log('[ZapManager] 追加ロード完了:', {
        newEventsCount,
        totalCacheSize: cacheManager.getZapEvents(viewId).length,
        lastEventTime: state.lastEventTime
      });

      // リストの更新後にトリガーを再設定
      if (newEventsCount > 0) {
        this.setupInfiniteScroll(viewId);
      }

      return newEventsCount;
    } catch (error) {
      console.error('[ZapManager] 追加ロード失敗:', error);
      return 0;
    } finally {
      state.isLoading = false;
    }
  }

  setupInfiniteScroll(viewId) {
    const cachedEvents = cacheManager.getZapEvents(viewId);
    if (cachedEvents.length < APP_CONFIG.INITIAL_LOAD_COUNT) {
      return;
    }

    const dialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (!dialog) return;

    const list = dialog.shadowRoot.querySelector('.dialog-zap-list');
    if (!list) return;

    // 既存のオブザーバーをクリーンアップ
    const existingTrigger = list.querySelector('.load-more-trigger');
    if (existingTrigger) {
      const existingObserver = this.observers?.get(viewId);
      if (existingObserver) {
        existingObserver.disconnect();
        existingTrigger.remove();
      }
    }

    // オブザーバーを保持するためのMapを初期化
    if (!this.observers) {
      this.observers = new Map();
    }

    // 新しいトリガーを作成
    const trigger = document.createElement('div');
    trigger.className = 'load-more-trigger';
    list.appendChild(trigger);

    console.log('[ZapManager] 無限スクロール設定:', { viewId });

    // デバウンス用のタイマーIDを保持
    let debounceTimer = null;
    // ロード中フラグ
    let isLoading = false;

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          // すでにロード中の場合は何もしない
          if (isLoading) return;

          // 前のタイマーをクリア
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          // デバウンス処理を設定（200ms）
          debounceTimer = setTimeout(async () => {
            console.log('[ZapManager] スクロールトリガー検出:', {
              intersectionRatio: entry.intersectionRatio
            });
            
            isLoading = true;
            const loadedCount = await this.loadMoreZaps(viewId);
            isLoading = false;

            if (loadedCount === 0) {
              console.log('[ZapManager] これ以上のデータなし');
              observer.disconnect();
              trigger.remove();
              this.observers.delete(viewId);
            }
          }, 200);
        }
      },
      { 
        root: list,
        rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
        threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
      }
    );

    observer.observe(trigger);
    this.observers.set(viewId, observer);
  }
}

const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
