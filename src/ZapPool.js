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

      let processedEvents = 0;
      const sub = this.pool.zapPool.subscribeMany(
        this.relayUrls,
        [
          {
            kinds: [1, 30023, 30030, 30009, 40, 41, 31990], // サポートするイベントの���類を拡張
            ids: items
          }
        ],
        {
          onevent: (event) => {
            this.resolveItem(event.id, event);
            processedEvents++;
            if (processedEvents === items.length) {
              sub.close();
              resolve();
            }
          },
          oneose: () => {
            // 未解決のアイテムを処理
            items.forEach(id => {
              if (this.resolvers.has(id)) {
                this.resolveItem(id, null);
              }
            });
            resolve();
          }
        }
      );

      // タイムアウト処理
      setTimeout(() => {
        sub.close();
        items.forEach(id => {
          if (this.resolvers.has(id)) {
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
  }

  closeSubscription(viewId, type = 'zap') {
    const subs = this.subscriptions.get(viewId);
    const state = this.state.get(viewId);
    
    if (subs?.[type] && !state?.isZapClosed) {
      subs[type].close();
      if (type === 'zap') {
        state.isZapClosed = true;
      }
    }
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    this.closeSubscription(viewId, 'zap');
    
    if (!this.subscriptions.has(viewId)) {
      this.subscriptions.set(viewId, { zap: null, realTime: null });
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

    setTimeout(() => this.closeSubscription(viewId, 'zap'), CONFIG.SUBSCRIPTION_TIMEOUT);
  }

  subscribeToRealTime(viewId, config, decoded, handlers) {
    const subs = this.subscriptions.get(viewId);
    if (!subs || subs.realTime) return;  // Fix: Check if subs exists

    subs.realTime = this.zapPool.subscribeMany(
      config.relayUrls,
      [{
        ...decoded.req,
        limit: CONFIG.DEFAULT_LIMIT,
        since: Math.floor(Date.now() / 1000)
      }],
      handlers
    );
  }

  async fetchReference(relayUrls, eventId) {
    if (!eventId || !relayUrls || !Array.isArray(relayUrls)) {
      return null;
    }
    this.referenceProcessor.setRelayUrls(relayUrls);
    try {
      const reference = await this.referenceProcessor.getOrCreateFetchPromise(eventId);
      return reference;
    } catch (error) {
      console.error("Error fetching reference:", error);
      return null;
    }
  }
}

export const poolManager = new ZapPoolManager();
export const { zapPool, profilePool } = poolManager;
