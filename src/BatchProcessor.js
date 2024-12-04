export class BatchProcessor {
  constructor(options = {}) {
    this._validateOptions(options);
    this._initializeProperties(options);
  }

  _validateOptions(options) {
    if (!options.pool?.ensureRelay) {
      throw new Error('Invalid pool object: ensureRelay method is required');
    }
  }

  _initializeProperties(options) {
    this.pool = options.pool;
    this.batchSize = options.batchSize || 50;
    this.batchDelay = options.batchDelay || 100;
    this.relayUrls = options.relayUrls || [];
    
    this.batchQueue = new Set();
    this.pendingFetches = new Map();
    this.resolvers = new Map();
    this.processingItems = new Set();
    this.batchTimer = null;

    this.eventCache = new Map();
    this.maxCacheAge = options.maxCacheAge || 1800000;
  }

  getOrCreateFetchPromise(key) {
    if (this.pendingFetches.has(key)) {
      return this.pendingFetches.get(key);
    }

    const promise = new Promise(resolve => {
      this.resolvers.set(key, resolve);
    });
    this.pendingFetches.set(key, promise);
    this.batchQueue.add(key);
    this._scheduleBatchProcess();
    return promise;
  }

  _scheduleBatchProcess() {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this._processBatchQueue();
    }, this.batchDelay);
  }

  async _processBatchQueue() {
    if (this.batchQueue.size === 0) return;

    const batchItems = this._getBatchItems();
    await this._processBatch(batchItems);
    
    // _scheduleNextBatchの代わりに直接次のバッチをスケジュール
    if (this.batchQueue.size > 0) {
      this._scheduleBatchProcess();
    }
  }

  _getBatchItems() {
    const batchItems = Array.from(this.batchQueue).splice(0, this.batchSize);
    this.batchQueue = new Set(Array.from(this.batchQueue).filter(key => !batchItems.includes(key)));
    batchItems.forEach(key => this.processingItems.add(key));
    return batchItems;
  }

  async _processBatch(batchItems) {
    try {
      await this.onBatchProcess(batchItems);
    } catch (error) {
      this._handleBatchError(batchItems, error);
    } finally {
      this._cleanupBatchItems(batchItems);
    }
  }

  _handleBatchError(items, error) {
    console.error(`${this.constructor.name} batch processing error:`, error);
    items.forEach(item => this.resolveItem(item, null));
  }

  _cleanupBatchItems(items) {
    items.forEach(key => {
      this.processingItems.delete(key);
      this.pendingFetches.delete(key);
      this.resolvers.delete(key);
    });
  }

  resolveItem(key, result) {
    const resolver = this.resolvers.get(key);
    if (resolver) {
      resolver(result);
      this.resolvers.delete(key);
    }
  }

  // Override these methods in derived classes
  async onBatchProcess(items) {
    throw new Error("onBatchProcess must be implemented by derived class");
  }

  onBatchError(items, error) {
    console.error(`Batch processing error in ${this.constructor.name}:`, error);
    items.forEach(item => this.resolveItem(item, null));
  }

  // 共通の_cleanup処理を基底クラスに移動
  _cleanup(timeoutId, sub, items, processedItems) {
    clearTimeout(timeoutId);
    if (sub) sub.close();
    items.forEach(item => {
      if (!processedItems.has(item) && this.resolvers.has(item)) {
        this.resolveItem(item, null);
      }
    });
  }

  // プール参照を抽象化
  _getSubscriptionPool() {
    return this.pool;
  }

  // 共通のプロミスベースの処理を抽象化
  async _createSubscriptionPromise(items, relayUrls, filter, eventHandler) {
    if (!relayUrls?.length) {
      items.forEach(id => this.resolveItem(id, null));
      return;
    }

    return new Promise((resolve) => {
      const processedItems = new Set();
      let timeoutId;

      const pool = this._getSubscriptionPool();
      const sub = pool.subscribeMany(
        relayUrls,
        filter,
        {
          onevent: (event) => {
            eventHandler(event, processedItems);
          },
          oneose: () => {
            this._cleanup(timeoutId, sub, items, processedItems);
            resolve();
          }
        }
      );

      timeoutId = setTimeout(() => {
        this._cleanup(timeoutId, sub, items, processedItems);
        resolve();
      }, 5000);
    });
  }

  setRelayUrls(urls) {
    this.relayUrls = Array.isArray(urls) ? urls : [];
  }

  async connectToRelays() {
    if (!this.relayUrls?.length) {
      throw new Error('No relays configured');
    }

    const results = await this._connectToRelays();
    const connectedCount = this._countSuccessfulConnections(results);
    
    if (connectedCount === 0) {
      throw new Error('Failed to connect to any relay');
    }

    return connectedCount;
  }

  async _connectToRelays() {
    const connectionPromises = this.relayUrls.map(url => 
      this.pool.ensureRelay(url).catch(error => {
        console.warn(`Failed to connect to relay ${url}:`, error);
        return null;
      })
    );
    return Promise.allSettled(connectionPromises);
  }

  _countSuccessfulConnections(results) {
    return results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
  }

  // キャッシュ関連メソッドの改善
  getCachedItem(key) {
    const cached = this.eventCache.get(key);
    if (!this._isValidCache(cached)) {
      this.eventCache.delete(key);
      return null;
    }
    return cached.event;
  }

  _isValidCache(cached) {
    if (!cached) return false;
    return (Date.now() - cached.timestamp) <= this.maxCacheAge;
  }

  setCachedItem(key, event) {
    this.eventCache.set(key, {
      event,
      timestamp: Date.now()
    });
  }
}

export class ETagReferenceProcessor extends BatchProcessor {
  constructor(options = {}) {
    super(options);
  }

  async onBatchProcess(items) {
    const filter = [{
      kinds: [1, 30023, 30030, 30009, 40, 42, 31990],
      ids: items
    }];

    const eventHandler = (event, processedItems) => {
      this.resolveItem(event.id, event);
      processedItems.add(event.id);
    };

    return this._createSubscriptionPromise(items, this.relayUrls, filter, eventHandler);
  }
}

export class ATagReferenceProcessor extends BatchProcessor {
  constructor(options = {}) {
    super(options);
  }

  _parseAtagValue(aTagValue) {
    const parts = aTagValue.split(':');
    if (parts.length !== 3) return null;

    return {
      kind: parseInt(parts[0]),
      pubkey: parts[1],
      identifier: parts[2]
    };
  }

  async onBatchProcess(items) {
    // aタグの値を解析してフィルターを作成
    const filters = items.map(aTagValue => {
      const parsed = this._parseAtagValue(aTagValue);
      if (!parsed) return null;

      return {
        kinds: [parsed.kind],
        authors: [parsed.pubkey],
        '#d': [parsed.identifier]
      };
    }).filter(Boolean);

    if (filters.length === 0) {
      items.forEach(item => this.resolveItem(item, null));
      return;
    }

    const eventHandler = (event, processedItems) => {
      const aTagValue = items.find(item => {
        const parsed = this._parseAtagValue(item);
        return parsed && 
               event.kind === parsed.kind && 
               event.pubkey === parsed.pubkey &&
               event.tags.some(t => t[0] === 'd' && t[1] === parsed.identifier);
      });

      if (aTagValue) {
        this.resolveItem(aTagValue, event);
        processedItems.add(aTagValue);
      }
    };

    return this._createSubscriptionPromise(items, this.relayUrls, filters, eventHandler);
  }
}

export class ProfileProcessor extends BatchProcessor {
  constructor(options = {}) {
    const { simplePool, config } = options;
    super({
      pool: simplePool,
      batchSize: config.BATCH_SIZE,
      batchDelay: config.BATCH_DELAY,
      relayUrls: config.RELAYS,
      maxCacheAge: 1800000 // 30分
    });
    this.config = config;
  }

  async onBatchProcess(pubkeys) {
    if (!this.config.RELAYS?.length) {
      throw new Error('No relays configured for profile fetch');
    }

    const uncachedPubkeys = pubkeys.filter(pubkey => {
      const cached = this.getCachedItem(pubkey);
      if (cached) {
        this.resolveItem(pubkey, cached);
        return false;
      }
      return true;
    });

    if (uncachedPubkeys.length === 0) return;

    const filter = [{
      kinds: [0],
      authors: uncachedPubkeys
    }];

    const latestEvents = new Map();

    const eventHandler = (event, processedItems) => {
      const currentEvent = latestEvents.get(event.pubkey);
      if (!currentEvent || event.created_at > currentEvent.created_at) {
        latestEvents.set(event.pubkey, event);
        this.setCachedItem(event.pubkey, event);
      }
      processedItems.add(event.pubkey);
    };

    try {
      await this._createSubscriptionPromise(
        uncachedPubkeys,
        this.config.RELAYS,
        filter,
        eventHandler
      );

      uncachedPubkeys.forEach(pubkey => {
        const latestEvent = latestEvents.get(pubkey);
        this.resolveItem(pubkey, latestEvent || null);
      });

    } catch (error) {
      console.error("Profile fetch error:", error);
      this.onBatchError(pubkeys, error);
    }
  }
}