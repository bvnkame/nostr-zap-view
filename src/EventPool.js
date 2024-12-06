import { SimplePool } from "nostr-tools/pool";
import { BATCH_CONFIG, REQUEST_CONFIG } from "./AppSettings.js";
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
      batchSize: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_SIZE,
      batchDelay: BATCH_CONFIG.REFERENCE_PROCESSOR.BATCH_DELAY
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
    console.log('Sending Zap subscription request:', {
      viewId,
      relayUrls: config.relayUrls,
      filter: decoded.req
    });
    
    this.#subscriptions.get(viewId).zap = this.#zapPool.subscribeMany(
      config.relayUrls,
      [decoded.req],
      handlers
    );
  }

  #validateEvent(event) {
    return event && event.id && Array.isArray(event.tags);
  }

  #createReferenceFilter(type, tag) {
    if (type === 'a') {
      const [kind, pubkey, identifier] = tag[1].split(':');
      return {
        kinds: [parseInt(kind)],
        authors: [pubkey],
        '#d': [identifier]
      };
    } else if (type === 'e' && /^[0-9a-f]{64}$/.test(tag[1].toLowerCase())) {
      return { ids: [tag[1].toLowerCase()] };
    }
    return null;
  }

  async #handleReferenceFetch(eventId, relayUrls, filter) {
    const promise = this.#fetchEventWithFilter(relayUrls, filter)
      .then(result => {
        if (result) {
          cacheManager.setReference(eventId, result);
        }
        this.#referenceFetching.delete(eventId);
        return result;
      });

    this.#referenceFetching.set(eventId, promise);
    return promise;
  }

  #handleReferenceError(eventId, error) {
    console.error('Reference fetch error:', error);
    if (eventId) {
      this.#referenceFetching.delete(eventId);
    }
    return null;
  }

  async #fetchEventWithFilter(relayUrls, filter) {
    if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
      console.warn('No relay URLs provided for event fetch');
      return null;
    }

    try {
      console.log('Sending reference event request:', {
        relayUrls,
        filter
      });

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

  // Connection management
  async connectToRelays(zapRelayUrls) {
    if (this.#isConnected) return;
    try {
      await this.#setupProcessors(zapRelayUrls);
      this.#isConnected = true;
    } catch (error) {
      this.#handleError("リレー接続エラー", error);
    }
  }

  async #setupProcessors(zapRelayUrls) {
    const processors = [this.#etagProcessor, this.#aTagProcessor];
    processors.forEach(p => p.setRelayUrls(zapRelayUrls));
    return Promise.all(processors.map(p => p.connectToRelays()));
  }

  // Subscription management
  closeSubscription(viewId) {
    const subscription = this.#subscriptions.get(viewId);
    const state = this.#state.get(viewId);

    if (!subscription?.zap || !state) return;

    if (!state.isZapClosed) {
      subscription.zap.close();
      state.isZapClosed = true;
    }
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    try {
      this.#validateSubscription(decoded);
      this.#initializeSubscriptionState(viewId);
      this.closeSubscription(viewId);
      
      const state = this.#state.get(viewId);
      state.isZapClosed = false;
      
      this.#createSubscription(viewId, config, decoded, this.#wrapHandlers(handlers));
    } catch (error) {
      this.#handleError("サブスクリプションエラー", error);
    }
  }

  #validateSubscription(decoded) {
    if (!decoded?.req?.kinds || !Array.isArray(decoded.req.kinds)) {
      throw new Error("無効なサブスクリプション設定");
    }
  }

  // Reference handling
  async fetchReference(relayUrls, event, type) {
    try {
      if (!this.#validateEvent(event)) return null;

      const tag = event.tags.find(t => Array.isArray(t) && t[0] === type);
      if (!tag) return null;

      const cached = cacheManager.getReference(event.id);
      if (cached) return cached;

      const pending = this.#referenceFetching.get(event.id);
      if (pending) return pending;

      const filter = this.#createReferenceFilter(type, tag);
      if (!filter) return null;

      return this.#handleReferenceFetch(event.id, relayUrls, filter);
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
