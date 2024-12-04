import { SimplePool } from "nostr-tools/pool";
import { PROFILE_CONFIG, BATCH_CONFIG } from "./AppSettings.js";
import {
  ETagReferenceProcessor,
  ATagReferenceProcessor,
} from "./BatchProcessor.js";
import { cacheManager } from "./CacheManager.js";

class ZapPoolManager {
  constructor() {
    this.zapPool = new SimplePool();
    this.profilePool = new SimplePool();
    this.subscriptions = new Map();
    this.state = new Map();

    // それぞれのプロセッサーを正しく初期化
    this.etagProcessor = new ETagReferenceProcessor(this, {
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY,
    });
    this.aTagProcessor = new ATagReferenceProcessor(this, {
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY,
    });

    this.isConnected = false;
  }

  async connectToRelays(zapRelayUrls) {
    if (this.isConnected) return;

    try {
      await Promise.allSettled(
        PROFILE_CONFIG.RELAYS.map((url) => this.profilePool.ensureRelay(url))
      );

      await Promise.allSettled(
        zapRelayUrls.map((url) => this.zapPool.ensureRelay(url))
      );

      this.isConnected = true;
    } catch (error) {}
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

  // fetchReference メソッドも更新
  async fetchReference(relayUrls, eventId) {
    if (!eventId) return null;

    try {
      const cachedRef = cacheManager.getReference(eventId);
      if (cachedRef) return cachedRef;

      this.etagProcessor.setRelayUrls(relayUrls);
      const reference = await this.etagProcessor.getOrCreateFetchPromise(
        eventId
      );

      if (reference) {
        cacheManager.setReference(eventId, reference);
      }

      return reference;
    } catch (error) {
      console.error("参照取得エラー:", error);
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

export const poolManager = new ZapPoolManager();
export const { zapPool, profilePool } = poolManager;
