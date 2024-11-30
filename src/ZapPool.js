import { SimplePool } from "nostr-tools/pool";
import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";
import { BatchProcessor } from "./BatchProcessor.js";

class ReferenceProcessor extends BatchProcessor {
  constructor(pool, config) {
    super({
      batchSize: 10,
      batchDelay: 50
    });
    this.pool = pool;
    this.config = config;
    this.relayUrls = null;  // Add: relayUrlsを保持するプロパティ
  }

  setRelayUrls(urls) {  // Add: relayUrlsを設定するメソッド
    this.relayUrls = urls;
  }

  async onBatchProcess(items) {
    return new Promise((resolve) => {
      if (!this.relayUrls || !Array.isArray(this.relayUrls)) {
        console.error("No relay URLs provided");
        items.forEach(id => this.resolveItem(id, null));
        resolve();
        return;
      }

      let timeoutId;
      let processedEvents = new Set();

      const sub = this.pool.zapPool.subscribeMany(
        this.relayUrls,
        [
          {
            kinds: [1, 30023, 30030, 30009, 40, 41, 31990], // サポートするイベントの種類を拡張
            ids: items
          }
        ],
        {
          onevent: (event) => {
            processedEvents.add(event.id);
            this.resolveItem(event.id, event);
            
            // 全てのイベントを受信したらサブスクリプションを終了
            if (items.every(id => processedEvents.has(id))) {
              clearTimeout(timeoutId);
              sub.close();
              resolve();
            }
          },
          oneose: () => {
            // 未解決のアイテムを処理
            items.forEach(id => {
              if (!processedEvents.has(id) && this.resolvers.has(id)) {
                this.resolveItem(id, null);
              }
            });
            resolve();
          }
        }
      );

      // タイムアウト処理の改善
      timeoutId = setTimeout(() => {
        sub.close();
        items.forEach(id => {
          if (!processedEvents.has(id) && this.resolvers.has(id)) {
            this.resolveItem(id, null);
          }
        });
        resolve();
      }, CONFIG.SUBSCRIPTION_TIMEOUT);
    });
  }

  onBatchError(items, error) {
    items.forEach(id => this.resolveItem(id, null));
  }
}

class ZapPoolManager {
  constructor() {
    this.zapPool = new SimplePool();
    this.profilePool = new SimplePool();
    this.subscriptions = new Map(); // 複数のビューをサポートするためにMapに変更
    this.state = new Map(); // 状態も複数管理
    // referencePoolを削除
    this.referenceProcessor = new ReferenceProcessor(this, CONFIG);
    this.referenceCache = new Map(); // リファレンスキャッシュを追加
  }

  closeSubscription(viewId) {
    const subs = this.subscriptions.get(viewId);
    const state = this.state.get(viewId);
    
    if (subs?.zap && !state?.isZapClosed) {
      subs.zap.close();
      state.isZapClosed = true;
    }
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    this.closeSubscription(viewId);
    
    if (!this.subscriptions.has(viewId)) {
      this.subscriptions.set(viewId, { zap: null });
      this.state.set(viewId, { isZapClosed: false });
    }

    const state = this.state.get(viewId);
    state.isZapClosed = false;

    const subs = this.subscriptions.get(viewId);
    subs.zap = this.zapPool.subscribeMany(
      config.relayUrls,
      [{ ...decoded.req }],  // Fix: Make sure decoded.req is an array
      handlers
    );

    setTimeout(() => this.closeSubscription(viewId), CONFIG.SUBSCRIPTION_TIMEOUT);
  }

  // subscribeToRealTimeメソッドを削除

  async fetchReference(relayUrls, eventId) {
    if (!eventId || !relayUrls || !Array.isArray(relayUrls)) {
      return null;
    }
    
    try {
      this.referenceProcessor.setRelayUrls(relayUrls);
      const reference = await this.referenceProcessor.getOrCreateFetchPromise(eventId);
      // キャッシュのために参照を保持
      if (reference) {
        this.referenceCache.set(eventId, reference);
      }
      return reference || this.referenceCache.get(eventId);
    } catch (error) {
      console.error("Error fetching reference:", error);
      return this.referenceCache.get(eventId);
    }
  }
}

export const poolManager = new ZapPoolManager();
export const { zapPool, profilePool } = poolManager;
