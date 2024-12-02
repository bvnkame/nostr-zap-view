import { 
  showDialog, 
  renderZapListFromCache, 
  showNoZapsMessage,
  initializeZapPlaceholders, // 追加
  initializeZapStats // 追加
} from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js"; // isEventIdentifierを追加
import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";
import { statsManager } from "./StatsManager.js";
import { poolManager } from "./ZapPool.js"; // 既存のインポート

class ZapSubscriptionManager {
  // ビューの状態とconfig情報を管理するクラス

  constructor() {
    this.viewStates = new Map(); // 各ビューの状態を管理
    this.configStore = new Map(); // 設定を保存するためのMap
  }

  /**
   * 指定されたviewIdの状態を取得。存在しない場合は新規作成
   * @param {string} viewId - ビューの一意識別子
   * @returns {Object} ビューの状態オブジェクト
   */
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

  /**
   * 特定のビューの設定を保存
   * @param {string} viewId - ビューの一意識別子
   * @param {Object} config - 保存する設定オブジェクト
   */
  setViewConfig(viewId, config) {
    this.configStore.set(viewId, config);
  }

  /**
   * 特定のビューの設定を取得
   * @param {string} viewId - ビューの一意識別子
   * @returns {Object} 保存された設定オブジェクト
   */
  getViewConfig(viewId) {
    return this.configStore.get(viewId);
  }

  /**
   * ビューのキャッシュをクリア
   * @param {string} viewId - クリアするビューのID
   */
  clearCache(viewId) {
    const state = this.getOrCreateViewState(viewId);
    state.zapEventsCache = [];
    state.currentStats = null;  // Fix: currentStatsをクリア
  }

  /**
   * Zapイベントの処理を行う
   * - キャッシュに存在しない場合のみ処理
   * - リファレンス情報の更新
   * - UIの更新
   * @param {Object} event - Zapイベント
   * @param {string} viewId - ビューID
   */
  async handleZapEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    console.log('[ZapManager] 受信したZapイベント:', event);
    
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      await this.updateEventReference(event, viewId);
      
      const isRealTime = event.created_at >= Math.floor(Date.now() / 1000) - 5;
      event.isRealTimeEvent = isRealTime;

      // キャッシュに追加して時系列でソート
      state.zapEventsCache.push(event);
      state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      console.log('[ZapManager] キャッシュ更新後の状態:', {
        totalEvents: state.zapEventsCache.length,
        isRealTime,
        eventId: event.id
      });

      // 統計情報を更新
      await statsManager.handleZapEvent(event, state, viewId);
    } else {
      console.log('[ZapManager] 重複イベントをスキップ:', event.id);
    }
  }

  /**
   * イベントの参照情報を更新
   * - note1/nevent1の場合はスキップ
   * - リレーから参照情報をフェッチ
   * @param {Object} event - Zapイベント
   * @param {string} viewId - ビューID
   * @returns {boolean} 更新成功の有無
   */
  async updateEventReference(event, viewId) {
    const eTag = event.tags.find(tag => tag[0] === 'e');
    const config = this.getViewConfig(viewId);
    
    // Identifierがnote1またはnevent1の場合は参照情報を取得しない
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

  /**
   * イベントバッチの参照情報を一括更新
   * @param {Array} events - Zapイベントの配列
   * @param {string} viewId - ビューID
   */
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

  /**
   * サブスクリプションの初期化
   * - 識別子のデコード
   * - Zapイベントの購読開始
   * @param {Object} config - 設定オブジェクト
   * @param {string} viewId - ビューID
   */
  async initializeSubscriptions(config, viewId) {
    console.log('[ZapManager] サブスクリプション初期化開始:', {
      viewId,
      config
    });

    const decoded = decodeIdentifier(config.identifier);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    this.setViewConfig(viewId, config);
    const state = this.getOrCreateViewState(viewId);
    state.isInitialFetchComplete = false;
    state.lastEventTime = null;
    state.isLoading = false;

    return new Promise((resolve) => {
      const events = [];
      poolManager.subscribeToZaps(viewId, config, decoded, {
        onevent: async (event) => {
          console.log('[ZapManager] リレーからイベント受信:', {
            eventId: event.id,
            kind: event.kind,
            created_at: event.created_at
          });
          
          // イベントがキャッシュに存在しない場合のみ処理
          if (!state.zapEventsCache.some(e => e.id === event.id)) {
            await this.updateEventReference(event, viewId);
            events.push(event);

            // Update last event time
            if (!state.lastEventTime || event.created_at < state.lastEventTime) {
              state.lastEventTime = event.created_at;
            }
          }
        },
        oneose: async () => {
          if (events.length > 0) {
            // バッチでキャッシュに追加
            state.zapEventsCache.push(...events);
            state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);
            
            // 統計情報を更新
            for (const event of events) {
              await statsManager.handleZapEvent(event, state, viewId);
            }

            // UIを更新
            await renderZapListFromCache(state.zapEventsCache, viewId);
          }

          console.log('[ZapManager] リレー購読完了:', {
            newEvents: events.length,
            totalCache: state.zapEventsCache.length
          });
          
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

    // Create new trigger if not exists
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
        rootMargin: '500px', // 500pxに増やして早めに読み込み開始
        threshold: [0]  // しきい値を簡素化
      }
    );

    observer.observe(trigger);
  }

  /**
   * ビューのクリックイベントを処理
   * @param {string} viewId - ビューID
   */
  async handleViewClick(viewId) {
    try {
      if (!viewId) throw new Error("Missing view ID");
      const zapDialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
      if (!zapDialog) throw new Error(CONFIG.ERRORS.DIALOG_NOT_FOUND);

      const viewState = this.getOrCreateViewState(viewId);
      const config = this.getViewConfig(viewId);
      
      // configが未定義の場合のチェックを追加
      if (!config) {
        console.warn("Configuration not found for viewId:", viewId);
        showDialog(viewId);
        showNoZapsMessage(viewId);
        return;
      }

      showDialog(viewId);

      // キャッシュがある場合は即時表示
      if (viewState.zapEventsCache.length > 0) {
        await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
        return;
      }

      // キャッシュがない場合のみプレースホルダーを表示
      if (!viewState.isInitialFetchComplete) {
        initializeZapPlaceholders(config.maxCount, viewId);
        initializeZapStats(viewId);
      } else if (viewState.zapEventsCache.length === 0) {
        showNoZapsMessage(viewId);
      }
    } catch (error) {
      console.error("Error occurred while handling view click:", error);
    }
  }
}

const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
