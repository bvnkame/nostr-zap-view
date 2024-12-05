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
      // デバッグ情報を追加
      console.debug("Subscription attempt:", { viewId, config, decoded });

      this.#initializeSubscriptionState(viewId);
      this.closeSubscription(viewId);

      const state = this.#state.get(viewId);
      state.isZapClosed = false;

      // フィルターの検証を修正
      if (!this._isValidSubscription(decoded)) {
        console.warn("Invalid subscription:", decoded);
        throw new Error("無効なサブスクリプション設定");
      }

      this.#createSubscription(viewId, config, decoded, handlers);
    } catch (error) {
      this.#handleError("Subscription error", error);
    }
  }

  _isValidSubscription(decoded) {
    // 検証ロジックを緩和
    return decoded && 
           decoded.req && 
           typeof decoded.req === 'object' &&  // reqがオブジェクトであることを確認
           Array.isArray(decoded.req.kinds);   // kinds配列が存在することを確認
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
  async fetchReference(relayUrls, event, type) {
    try {
      // フィールドがnullでないことを確認
      if (!event || !event.id || !event.tags) {
        console.warn("無効なイベントデータ:", event);
        return null;
      }

      if (!event?.tags || !Array.isArray(event.tags)) {
        return null;
      }

      const tag = event.tags.find(t => Array.isArray(t) && t[0] === type);
      if (!tag) return null;

      // キャッシュチェック
      const cached = cacheManager.getReference(event.id);
      if (cached) return cached;

      // 進行中のフェッチチェック
      const pending = this.#referenceFetching.get(event.id);
      if (pending) return pending;

      let filter;
      if (type === 'a') {
        const [kind, pubkey, identifier] = tag[1].split(':');
        filter = {
          kinds: [parseInt(kind)],
          authors: [pubkey],
          '#d': [identifier]
        };
      } else if (type === 'e' && /^[0-9a-f]{64}$/.test(tag[1].toLowerCase())) {
        filter = { ids: [tag[1].toLowerCase()] };
      } else {
        return null;
      }

      const promise = this.fetchEventWithFilter(relayUrls, filter)
        .then(result => {
          if (result) {
            cacheManager.setReference(event.id, result);
          }
          this.#referenceFetching.delete(event.id);
          return result;
        });

      this.#referenceFetching.set(event.id, promise);
      return promise;
    } catch (error) {
      console.error('Reference fetch error:', error);
      this.#referenceFetching.delete(event.id);
      return null;
    }
  }

  // 最適化されたイベント取得メソッド
  async fetchEventWithFilter(relayUrls, filter) {
    if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
      console.warn('No relay URLs provided for event fetch');
      return null;
    }

    try {
      const events = await this.#zapPool.querySync(
        relayUrls,
        filter,
        { timeout: REQUEST_CONFIG.METADATA_TIMEOUT }
      );

      return events && events.length > 0
        ? events.sort((a, b) => b.created_at - a.created_at)[0]
        : null;
    } catch (error) {
      console.error('Event fetch error:', { error, filter, relayUrls });
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

  // Private helper methods
  #createSubscription(viewId, config, decoded, handlers) {
    try {
      // デバッグ情報を追加
      console.debug("Creating subscription:", {
        relayUrls: config.relayUrls,
        filter: decoded.req
      });

      this.#subscriptions.get(viewId).zap = this.#zapPool.subscribeMany(
        config.relayUrls,
        [decoded.req],
        {
          ...handlers,
          oneose: () => {
            handlers.oneose();
          },
        }
      );
    } catch (error) {
      console.error("Subscription creation failed:", error);
      throw error;
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
