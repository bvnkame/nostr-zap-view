import { SimplePool } from "nostr-tools/pool";
import { APP_CONFIG } from "./AppSettings.js";
import {
  ETagReferenceProcessor,
  ATagReferenceProcessor,
} from "./BatchProcessor.js";
import { cacheManager } from "./CacheManager.js";

export class EventPool {
  // Private fields declaration
  #zapPool;
  #isConnected;
  #subscriptions;
  #state;
  #referenceFetching;
  #etagProcessor;
  #aTagProcessor;

  constructor() {
    // 初期化
    this.#zapPool = new SimplePool();
    this.#initializeState();
    this.#initializeProcessors();
  }

  // Private initialization methods
  #initializeState() {
    this.#subscriptions = new Map();
    this.#state = new Map();
    this.#referenceFetching = new Map();
    this.#isConnected = false;
  }

  #initializeProcessors() {
    const processorConfig = {
      pool: this.#zapPool,
      batchSize: APP_CONFIG.BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: APP_CONFIG.BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY
    };
    this.#etagProcessor = new ETagReferenceProcessor(processorConfig);
    this.#aTagProcessor = new ATagReferenceProcessor(processorConfig);
  }

  // Private initialization and state management methods
  #initializeSubscriptionState(viewId) {
    if (!this.#subscriptions.has(viewId)) {
      this.#subscriptions.set(viewId, { zap: null });
    }
    if (!this.#state.has(viewId)) {
      this.#state.set(viewId, { isZapClosed: false });
    }
  }

  #createSubscription(viewId, config, decoded, handlers) {
    
    this.#subscriptions.get(viewId).zap = this.#zapPool.subscribeMany(
      config.relayUrls,
      [decoded.req],
      handlers
    );
  }

  #validateEvent(event) {
    return event && event.id && Array.isArray(event.tags);
  }

  #handleReferenceError(eventId, error) {
    console.error('Reference fetch error:', error);
    if (eventId) {
      this.#referenceFetching.delete(eventId);
    }
    return null;
  }

  // Connection management
  async connectToRelays(zapRelayUrls) {
    if (this.#isConnected) return;
    try {
      await this.#setupProcessors(zapRelayUrls);
      this.#isConnected = true;
    } catch (error) {
      this.#handleError("Relay connection error", error);
    }
  }

  async #setupProcessors(zapRelayUrls) {
    const processors = [this.#etagProcessor, this.#aTagProcessor];
    processors.forEach(p => p.setRelayUrls(zapRelayUrls));
    return Promise.all(processors.map(p => p.connectToRelays()));
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    try {
      this.#validateSubscription(decoded);
      this.#initializeSubscriptionState(viewId);
      
      const state = this.#state.get(viewId);
      state.isZapClosed = false;
      
      this.#createSubscription(viewId, config, decoded, this.#wrapHandlers(handlers));
    } catch (error) {
      this.#handleError("Subscription error", error);
    }
  }

  #validateSubscription(decoded) {
    if (!decoded?.req?.kinds || !Array.isArray(decoded.req.kinds)) {
      throw new Error("Invalid subscription settings");
    }
  }

  // Reference handling
  async fetchReference(_relayUrls, event, type) {
    try {
      if (!this.#validateEvent(event)) return null;

      const tag = event.tags.find(t => Array.isArray(t) && t[0] === type);
      if (!tag) return null;

      const tagValue = type === 'e' ? tag[1] : `${tag[1]}`; // キャッシュキーを抽出

      // イベントIDではなくタグの値でキャッシュを確認
      const cached = cacheManager.getReference(tagValue);
      if (cached) return cached;

      const pending = this.#referenceFetching.get(tagValue);
      if (pending) return pending;

      const processor = type === 'e' ? this.#etagProcessor : this.#aTagProcessor;

      try {
        const reference = await processor.getOrCreateFetchPromise(tagValue);
        
        if (reference) {
          // タグの値をキーとしてキャッシュ
          cacheManager.setReference(tagValue, reference);
        }
        this.#referenceFetching.delete(tagValue);
        return reference;
      } finally {
        this.#referenceFetching.delete(tagValue);
      }
    } catch (error) {
      return this.#handleReferenceError(event?.id, error);
    }
  }

  // Utility methods
  #wrapHandlers(handlers) {
    const subscriptionStartTime = Math.floor(Date.now() / 1000);
    return {
      ...handlers,
      onevent: (event) => {
        event.isRealTimeEvent = event.created_at >= subscriptionStartTime;
        handlers.onevent(event);
      },
      oneose: handlers.oneose
    };
  }

  #handleError(message, error) {
    console.error(`${message}:`, error);
    throw error;
  }

  // Getters
  get zapPool() {
    return this.#zapPool;
  }
}

export const eventPool = new EventPool();
export const { zapPool } = eventPool;
