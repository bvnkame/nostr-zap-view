import { SimplePool } from "nostr-tools/pool";
import { BATCH_CONFIG } from "./AppSettings.js";
import {
  ETagReferenceProcessor,
  ATagReferenceProcessor,
} from "./BatchProcessor.js";
import { cacheManager } from "./CacheManager.js";
import { profilePool } from "./ProfilePool.js";

export class EventPool {
  constructor() {
    this.zapPool = new SimplePool();
    this.subscriptions = new Map();
    this.state = new Map();  // stateマップの初期化を追加
    this.isConnected = false;

    this.etagProcessor = new ETagReferenceProcessor({
      pool: this.zapPool,  // zapPoolオブジェクトを直接渡す
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY
    });

    this.aTagProcessor = new ATagReferenceProcessor({
      pool: this.zapPool,  // zapPoolオブジェクトを直接渡す
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY
    });
  }

  async connectToRelays(zapRelayUrls) {
    if (this.isConnected) return;

    try {
      // 各プロセッサーにリレーURLを設定
      this.etagProcessor.setRelayUrls(zapRelayUrls);
      this.aTagProcessor.setRelayUrls(zapRelayUrls);

      // 並列で接続処理を実行
      await Promise.all([
        this.etagProcessor.connectToRelays(),
        this.aTagProcessor.connectToRelays()
      ]);

      this.isConnected = true;
      console.log("Zap relays connected");
    } catch (error) {
      console.error("Zap relay connection error:", error);
      throw error;
    }
  }

  closeSubscription(viewId) {
    const subscription = this.subscriptions.get(viewId);
    const state = this.state.get(viewId);

    if (!subscription || !state) return;  // 存在チェックを追加

    if (subscription.zap && !state.isZapClosed) {
      subscription.zap.close();
      state.isZapClosed = true;
    }
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    // 既存の購読を閉じる前に、新しい状態を初期化
    if (!this.subscriptions.has(viewId)) {
      this.subscriptions.set(viewId, { zap: null });
    }
    if (!this.state.has(viewId)) {
      this.state.set(viewId, { isZapClosed: false });
    }

    this.closeSubscription(viewId);  // 既存の購読を閉じる

    const state = this.state.get(viewId);
    state.isZapClosed = false;

    const subs = this.subscriptions.get(viewId);

    // コンソールログを追加して、リレーに送信されるREQを確認
    console.log("[ZapPool] REQ送信:", {
      relayUrls: config.relayUrls,
      req: decoded.req,
    });

    subs.zap = this.zapPool.subscribeMany(
      config.relayUrls,
      [{ ...decoded.req }],
      {
        ...handlers,
        onevent: (event) => {
          handlers.onevent(event);
        },
        oneose: () => {
          console.log("[ZapPool] リレー購読完了:", { viewId });
          handlers.oneose();
        },
      }
    );
  }

  async fetchReference(relayUrls, eventId) {
    if (!eventId) return null;

    try {
      const cachedRef = cacheManager.getReference(eventId);
      if (cachedRef) return cachedRef;

      this.etagProcessor.setRelayUrls(relayUrls);
      const reference = await this.etagProcessor.getOrCreateFetchPromise(eventId);

      if (reference) {
        cacheManager.setReference(eventId, reference);
      }

      return reference;
    } catch (error) {
      console.error("Reference fetch error:", error);
      return null;
    }
  }

  async fetchATagReference(relayUrls, aTagValue) {
    if (!aTagValue) return null;

    try {
      this.aTagProcessor.setRelayUrls(relayUrls);
      return await this.aTagProcessor.getOrCreateFetchPromise(aTagValue);
    } catch (error) {
      console.error("ATag reference fetch error:", error);
      return null;
    }
  }
}

export const eventPool = new EventPool();
export const { zapPool } = eventPool;  // profilePoolは直接ProfilePool.jsからエクスポート
