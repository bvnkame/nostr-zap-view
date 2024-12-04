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
      const aTag = event.tags.find(tag => tag[0] === 'a');
      const eTag = event.tags.find(tag => tag[0] === 'e');
      const config = this.getViewConfig(viewId);
      
      if (!config?.relayUrls?.length) {
        console.warn("No relay URLs configured for reference fetch");
        return false;
      }

      const identifier = config?.identifier || '';
      if (isEventIdentifier(identifier)) return false;

      const fetchReference = async () => {
        let reference = null;
        if (aTag) {
          try {
            reference = await eventPool.fetchATagReference(config.relayUrls, aTag[1]);
          } catch (error) {
            console.warn("A-tag reference fetch failed:", aTag[1], error);
          }
        }
        
        if (!reference && eTag) {
          const eventId = eTag[1].toLowerCase();
          if (/^[0-9a-f]{64}$/.test(eventId)) {
            try {
              reference = await eventPool.fetchReference(config.relayUrls, eventId);
            } catch (error) {
              console.warn("E-tag reference fetch failed:", eTag[1], error);
            }
          }
        }
        return reference;
      };

      const reference = await cacheManager.getOrFetchReference(event.id, fetchReference);
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

  async _processBatchEvents(batchEvents, viewId) {
    if (!Array.isArray(batchEvents) || batchEvents.length === 0) return;

    const pubkeys = [...new Set(batchEvents.map(event => event.pubkey))];
    
    await Promise.all([
      profilePool.fetchProfiles(pubkeys),
      this.updateEventReferenceBatch(batchEvents, viewId),
      ...batchEvents.map(event => statsManager.handleZapEvent(event, viewId)),
      ...batchEvents.map(event => profilePool.verifyNip05Async(event.pubkey))
    ]);

    if (this.zapListUI) {
      await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
      batchEvents.forEach(event => {
        if (event.reference) {
          this.zapListUI.updateZapReference(event);
        }
      });
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
    this._cleanupExistingScroll(viewId);
    const list = this._getListElement(viewId);
    if (!list) return;

    const { trigger, observer } = this._createScrollComponents(viewId, list);
    list.appendChild(trigger);
    observer.observe(trigger);
    this.observers.set(viewId, observer);
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
    const batchEvents = [];
    const batchSize = APP_CONFIG.BATCH_SIZE || 20; // バッチサイズを設定

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Load timeout'));
        }, APP_CONFIG.LOAD_TIMEOUT || 10000);

        eventPool.subscribeToZaps(viewId, config, decoded, {
          onevent: async (event) => {
            if (event.created_at < state.lastEventTime) {
              batchEvents.push(event);
              newEventsCount++;
              state.lastEventTime = Math.min(state.lastEventTime, event.created_at);

              // バッチサイズに達したら処理を終了
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

      // バッチ処理による一括表示
      if (newEventsCount > 0) {
        // 新しいイベントを時系列でソート
        batchEvents.sort((a, b) => b.created_at - a.created_at);
        
        // まとめてキャッシュに追加
        batchEvents.forEach(event => {
          cacheManager.addZapEvent(viewId, event);
        });

        // UI一括更新
        if (this.zapListUI) {
          await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
        }

        // 参照情報とプロフィール情報を並列で取得
        await Promise.all([
          this.updateEventReferenceBatch(batchEvents, viewId),
          Promise.all(batchEvents.map(event => profilePool.verifyNip05Async(event.pubkey))),
          Promise.all(batchEvents.map(event => statsManager.handleZapEvent(event, viewId)))
        ]);

        // リファレンス情報の一括更新
        if (this.zapListUI) {
          batchEvents.forEach(event => {
            if (event.reference) {
              this.zapListUI.updateZapReference(event);
            }
          });
        }
      }

      return newEventsCount;

    } catch (error) {
      console.error('[ZapManager] 追加ロード処理エラー:', error);
      return 0;
    }
  }

  // 無限スクロール機能の改善
  setupInfiniteScroll(viewId) {
    this.cleanupInfiniteScroll(viewId);
    const list = this.getListElement(viewId);
    if (!list) return;

    const trigger = this.createScrollTrigger();
    list.appendChild(trigger);

    const observer = new IntersectionObserver(
      this.createScrollHandler(viewId),
      this.getObserverOptions(list)
    );

    observer.observe(trigger);
    this.observers.set(viewId, observer);
  }

  cleanupInfiniteScroll(viewId) {
    const observer = this.observers.get(viewId);
    if (observer) {
      observer.disconnect();
      const list = this.getListElement(viewId);
      const trigger = list?.querySelector('.load-more-trigger');
      if (trigger) {
        trigger.remove();
      }
      this.observers.delete(viewId);
    }
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

  createScrollHandler(viewId) {
    let isLoading = false;
    let debounceTimer = null;

    return async (entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting || isLoading) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (isLoading) return;
        
        try {
          isLoading = true;
          const loadedCount = await this.loadMoreZaps(viewId);
          if (loadedCount === 0) {
            this.cleanupInfiniteScroll(viewId);
          }
        } finally {
          isLoading = false;
        }
      }, 300);
    };
  }

  getObserverOptions(list) {
    return {
      root: list,
      rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
      threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
    };
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
      
      // リファレンス情報を非同期で取得開始
      this.updateEventReference(event, viewId).then(hasReference => {
        if (hasReference && this.zapListUI && event.reference) {
          this.zapListUI.updateZapReference(event);
        }
      });

      // バッチサイズに達したら処理
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

  async _processBatchEvents(batchEvents, viewId) {
    if (batchEvents.length > 0) {
      const pubkeys = [...new Set(batchEvents.map(event => event.pubkey))];
      
      await Promise.all([
        // プロフィール取得
        profilePool.fetchProfiles(pubkeys),
        
        // リファレンス情報の取得と更新
        this.updateEventReferenceBatch(batchEvents, viewId).then(() => {
          batchEvents.forEach(event => {
            if (event.reference && this.zapListUI) {
              this.zapListUI.updateZapReference(event);
            }
          });
        }),
        
        // 統計情報の更新
        ...batchEvents.map(event => statsManager.handleZapEvent(event, viewId)),
        
        // NIP-05検証
        ...batchEvents.map(event => profilePool.verifyNip05Async(event.pubkey))
      ]);

      // 最終的なUI更新
      if (this.zapListUI) {
        await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
      }
    }
  }

  async _finalizeEventCollection(batchEvents, viewId) {
    if (batchEvents.length > 0 && this.zapListUI) {
      await this.zapListUI.batchUpdate(cacheManager.getZapEvents(viewId));
    }
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

  async _fetchEventReference(event, config) {
    const fetchFn = async () => {
      const aTag = event.tags.find(tag => tag[0] === 'a');
      const eTag = event.tags.find(tag => tag[0] === 'e');
      
      if (aTag) {
        try {
          return await eventPool.fetchATagReference(config.relayUrls, aTag[1]);
        } catch (error) {
          console.warn("A-tag reference fetch failed:", error);
        }
      }

      if (eTag && /^[0-9a-f]{64}$/.test(eTag[1].toLowerCase())) {
        try {
          return await eventPool.fetchReference(config.relayUrls, eTag[1]);
        } catch (error) {
          console.warn("E-tag reference fetch failed:", error);
        }
      }
      
      return null;
    };

    return await cacheManager.getOrFetchReference(event.id, fetchFn);
  }

  _createScrollComponents(viewId, list) {
    const trigger = document.createElement('div');
    trigger.className = 'load-more-trigger';

    const observer = new IntersectionObserver(
      this._createScrollHandler(viewId),
      {
        root: list,
        rootMargin: APP_CONFIG.INFINITE_SCROLL.ROOT_MARGIN,
        threshold: APP_CONFIG.INFINITE_SCROLL.THRESHOLD
      }
    );

    return { trigger, observer };
  }
}

// ZapSubscriptionManager を初期化する際に zapListUI を設定
const subscriptionManager = new ZapSubscriptionManager();
export { subscriptionManager };
