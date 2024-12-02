import { SimplePool } from "nostr-tools/pool";
import {
  ZAP_CONFIG as CONFIG,
  REQUEST_CONFIG,
  PROFILE_CONFIG,
} from "./AppSettings.js"; // PROFILE_CONFIGを追加
import { BatchProcessor } from "./BatchProcessor.js";

class ReferenceProcessor extends BatchProcessor {
  constructor(pool, config) {
    super({
      batchSize: 10,
      batchDelay: 50,
    });
    this.pool = pool;
    this.config = config;
    this.relayUrls = null; // Add: relayUrlsを保持するプロパティ
  }

  setRelayUrls(urls) {
    // Add: relayUrlsを設定するメソッド
    this.relayUrls = urls;
  }

  async onBatchProcess(items) {
    return new Promise((resolve) => {
      if (!this.relayUrls || !Array.isArray(this.relayUrls)) {
        console.error("No relay URLs provided");
        items.forEach((id) => this.resolveItem(id, null));
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
            ids: items,
          },
        ],
        {
          onevent: (event) => {
            processedEvents.add(event.id);
            this.resolveItem(event.id, event);

            // 全てのイベントを受信したらサブスクリプションを終了
            if (items.every((id) => processedEvents.has(id))) {
              clearTimeout(timeoutId);
              sub.close();
              resolve();
            }
          },
          oneose: () => {
            // 未解決のアイテムを処理
            items.forEach((id) => {
              if (!processedEvents.has(id) && this.resolvers.has(id)) {
                this.resolveItem(id, null);
              }
            });
            resolve();
          },
        }
      );

      // タイムアウト処理の改善
      timeoutId = setTimeout(() => {
        sub.close();
        items.forEach((id) => {
          if (!processedEvents.has(id) && this.resolvers.has(id)) {
            this.resolveItem(id, null);
          }
        });
        resolve();
      }, REQUEST_CONFIG.METADATA_TIMEOUT); // 変更: メタデータ用のタイムアウトを使用
    });
  }

  onBatchError(items, error) {
    items.forEach((id) => this.resolveItem(id, null));
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
    this.isConnected = false; // Add: リレー接続状態フラグ
  }

  // Add: リレーへの事前接続を行うメソッド
  async connectToRelays(zapRelayUrls) {
    if (this.isConnected) return;

    try {
      // プロフィール用リレーに接続
      await Promise.allSettled(
        PROFILE_CONFIG.RELAYS.map((url) => this.profilePool.ensureRelay(url))
      );

      // Zapリレーに接続
      await Promise.allSettled(
        zapRelayUrls.map((url) => this.zapPool.ensureRelay(url))
      );

      this.isConnected = true;
      console.log("[ZapPool] Connected to relays");
    } catch (error) {
      console.error("[ZapPool] Failed to connect to relays:", error);
    }
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
    console.log("[ZapPool] Zap購読開始:", {
      viewId,
      relayUrls: config.relayUrls,
      filter: decoded.req,
    });

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
      [{ ...decoded.req }], // Fix: Make sure decoded.req is an array
      {
        ...handlers,
        onevent: (event) => {
          console.log("[ZapPool] イベント受信:", {
            eventId: event.id,
            relayUrl: event.relay,
          });
          handlers.onevent(event);
        },
        oneose: () => {
          console.log("[ZapPool] リレー購読完了:", { viewId });
          handlers.oneose();
        },
      }
    );
  }

  // subscribeToRealTimeメソッドを削除

  async fetchReference(relayUrls, eventId) {
    if (!eventId || !relayUrls || !Array.isArray(relayUrls)) {
      return null;
    }

    try {
      this.referenceProcessor.setRelayUrls(relayUrls);
      const reference = await this.referenceProcessor.getOrCreateFetchPromise(
        eventId
      );
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
