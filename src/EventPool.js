import { SimplePool } from "nostr-tools/pool";
import { BATCH_CONFIG, REQUEST_CONFIG } from "./AppSettings.js";
import {
  ETagReferenceProcessor,
  ATagReferenceProcessor,
} from "./BatchProcessor.js";
import { cacheManager } from "./CacheManager.js";

export class EventPool {
  // Core components
  #zapPool;
  #isConnected;

  // Processors
  #etagProcessor;
  #aTagProcessor;

  // State management
  #subscriptions;
  #state;
  #referenceFetching; // 追加: プライベートプロパティとして定義

  constructor() {
    this.#zapPool = new SimplePool();
    this.#subscriptions = new Map();
    this.#state = new Map();
    this.#isConnected = false;
    this.#referenceFetching = new Map(); // 初期化を追加

    const processorConfig = {
      pool: this.#zapPool,
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY
    };

    this.#etagProcessor = new ETagReferenceProcessor(processorConfig);
    this.#aTagProcessor = new ATagReferenceProcessor(processorConfig);
  }

  // Connection management
  async connectToRelays(zapRelayUrls) {
    if (this.#isConnected) return;

    try {
      await this.#initializeProcessors(zapRelayUrls);
      this.#isConnected = true;
      console.log("Zap relays connected");
    } catch (error) {
      this.#handleError("Relay connection error", error);
    }
  }

  async #initializeProcessors(zapRelayUrls) {
    [this.#etagProcessor, this.#aTagProcessor].forEach(processor => 
      processor.setRelayUrls(zapRelayUrls)
    );

    return Promise.all([
      this.#etagProcessor.connectToRelays(),
      this.#aTagProcessor.connectToRelays()
    ]);
  }

  // Subscription management
  subscribeToZaps(viewId, config, decoded, handlers) {
    try {
      this.#initializeSubscriptionState(viewId);
      this.closeSubscription(viewId);

      const state = this.#state.get(viewId);
      state.isZapClosed = false;

      this.#logSubscription(config, decoded);
      this.#createSubscription(viewId, config, decoded, handlers);
    } catch (error) {
      this.#handleError("Subscription error", error);
    }
  }

  closeSubscription(viewId) {
    const subscription = this.#subscriptions.get(viewId);
    const state = this.#state.get(viewId);

    if (!subscription?.zap || !state) return;

    if (!state.isZapClosed) {
      subscription.zap.close();
      state.isZapClosed = true;
    }
  }

  // Reference handling
  async fetchReference(relayUrls, eventId) {
    try {
      if (!eventId) {
        console.warn('Invalid eventId provided');
        return null;
      }

      // キャッシュをまず確認
      const cached = cacheManager.getReference(eventId);
      if (cached) return cached;

      // 既に進行中のフェッチがあればそれを返す
      const pending = this.#referenceFetching.get(eventId); // 修正: プライベートプロパティにアクセス
      if (pending) return pending;

      // 新しいフェッチを開始
      const promise = this.fetchEventWithFilter(relayUrls, {
        ids: [eventId.toLowerCase()]
      }).then(result => {
        if (result) {
          cacheManager.setReference(eventId, result);
        }
        this.#referenceFetching.delete(eventId); // 修正: プライベートプロパティにアクセス
        return result;
      });

      this.#referenceFetching.set(eventId, promise); // 修正: プライベートプロパティにアクセス
      return promise;
    } catch (error) {
      console.error('Reference fetch error:', error);
      return null;
    }
  }

  async fetchATagReference(relayUrls, aTagValue) {
    try {
      const [kind, pubkey, identifier] = aTagValue.split(':');
      if (!kind || !pubkey || !identifier) {
        console.warn('Invalid a-tag format:', aTagValue);
        return null;
      }

      // フィルターを直接オブジェクトとして渡す
      const result = await this.fetchEventWithFilter(relayUrls, {
        kinds: [parseInt(kind)],
        authors: [pubkey],
        '#d': [identifier]
      });

      if (result) {
        console.debug('A-tag reference found:', { aTagValue, result });
      }
      return result;
    } catch (error) {
      console.error('A-tag reference fetch error:', error);
      return null;
    }
  }

  // 参照関連の処理をEventPoolクラスに統合
  extractReferenceFromTags(event) {
    if (!event?.tags) return null;

    const [eTag, pTag] = [
      event.tags.find(tag => tag[0] === "e"),
      event.tags.find(tag => tag[0] === "p")
    ];

    if (!eTag) return null;

    return {
      id: eTag[1],
      kind: parseInt(eTag[3], 10) || 1,
      pubkey: pTag?.[1] || event.pubkey || "",
      content: event.content || "",
      tags: event.tags || [],
    };
  }

  // 追加: イベント取得の共通メソッド
  async fetchEventWithFilter(relayUrls, filter) {
    try {
      if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
        console.warn('No relay URLs provided for event fetch');
        return null;
      }

      // フィルターの形式を修正
      const events = await this.#zapPool.querySync(
        relayUrls,
        filter,  // 配列で包まない
        { 
          timeout: REQUEST_CONFIG.METADATA_TIMEOUT 
        }
      );

      if (!events || events.length === 0) {
        console.debug('No events found for filter:', filter);
        return null;
      }

      // 最新のイベントを返す
      return events.sort((a, b) => b.created_at - a.created_at)[0];
    } catch (error) {
      console.error('Event fetch error:', { error, filter, relayUrls });
      return null;
    }
  }

  // Private helper methods
  #createSubscription(viewId, config, decoded, handlers) {
    this.#subscriptions.get(viewId).zap = this.#zapPool.subscribeMany(
      config.relayUrls,
      [decoded.req],
      {
        ...handlers,
        oneose: () => {
          console.log("[ZapPool] リレー購読完了:", { viewId });
          handlers.oneose();
        },
      }
    );
  }

  async #processCachedReference(relayUrls, eventId) {
    try {
      const cachedRef = cacheManager.getReference(eventId);
      if (cachedRef) return cachedRef;

      const reference = await this.#processReference(relayUrls, eventId, this.#etagProcessor);
      if (reference) {
        cacheManager.setReference(eventId, reference);
      }
      return reference;
    } catch (error) {
      this.#handleError("Reference processing error", error);
      return null;
    }
  }

  async #processReference(relayUrls, value, processor) {
    try {
      processor.setRelayUrls(relayUrls);
      return await processor.getOrCreateFetchPromise(value);
    } catch (error) {
      this.#handleError("Reference processing error", error);
      return null;
    }
  }

  #logSubscription(config, decoded) {
    console.log("[ZapPool] REQ送信:", {
      relayUrls: config.relayUrls,
      req: decoded.req,
    });
  }

  #handleError(message, error) {
    console.error(message + ":", error);
    throw error;
  }

  #initializeSubscriptionState(viewId) {
    if (!this.#subscriptions.has(viewId)) {
      this.#subscriptions.set(viewId, { zap: null });
    }
    if (!this.#state.has(viewId)) {
      this.#state.set(viewId, { isZapClosed: false });
    }
  }

  // Getter
  get zapPool() {
    return this.#zapPool;
  }
}

export const eventPool = new EventPool();
export const { zapPool } = eventPool;
