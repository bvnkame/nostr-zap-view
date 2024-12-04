export class BatchProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.batchDelay = options.batchDelay || 100;
    this.batchQueue = new Set();
    this.pendingFetches = new Map();
    this.resolvers = new Map();
    this.processingItems = new Set();
    this.batchTimer = null;
    if (!options.pool?.ensureRelay) {
      throw new Error('Invalid pool object: ensureRelay method is required');
    }
    this.pool = options.pool;
    this.relayUrls = options.relayUrls || [];
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

    const batchItems = Array.from(this.batchQueue).splice(0, this.batchSize);
    this.batchQueue = new Set(Array.from(this.batchQueue).filter(key => !batchItems.includes(key)));

    batchItems.forEach(key => this.processingItems.add(key));

    try {
      await this.onBatchProcess(batchItems);
    } catch (error) {
      console.error("Batch processing failed:", error);
      this.onBatchError(batchItems, error);
    } finally {
      batchItems.forEach(key => {
        this.processingItems.delete(key);
        this.pendingFetches.delete(key);
        this.resolvers.delete(key);
      });

      if (this.batchQueue.size > 0) {
        this._scheduleBatchProcess();
      }
    }
  }

  async processBatch() {
    if (this.currentBatch.size === 0) return;

    const items = Array.from(this.currentBatch);
    this.currentBatch.clear();

    try {
      // バッチ処理を非同期で実行し、完了を待たない
      this.onBatchProcess(items).catch(error => {
        console.error("Batch processing error:", error);
        this.onBatchError(items, error);
      });
    } catch (error) {
      console.error("Batch processing error:", error);
      this.onBatchError(items, error);
    }
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
    throw new Error("Not implemented");
  }

  onBatchError(items, error) {
    throw new Error("Not implemented");
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

    try {
      const pool = this._getSubscriptionPool();
      const connectionPromises = this.relayUrls.map(url => 
        pool.ensureRelay(url)
          .catch(error => {
            console.warn(`Failed to connect to relay ${url}:`, error);
            return null;
          })
      );

      const results = await Promise.allSettled(connectionPromises);
      const connectedCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

      if (connectedCount === 0) {
        throw new Error('Failed to connect to any relay');
      }

      return connectedCount;
    } catch (error) {
      console.error("Relay connection error:", error);
      throw error;
    }
  }
}

export class ETagReferenceProcessor extends BatchProcessor {
  constructor(options = {}) {
    super({
      pool: options.pool,
      batchSize: options.batchSize || 50,
      batchDelay: options.batchDelay || 100,
    });
    this.relayUrls = [];
  }

  setRelayUrls(urls) {
    this.relayUrls = Array.isArray(urls) ? urls : [];
  }

  async onBatchProcess(items) {
    const filter = [{
      kinds: [1, 30023, 30030, 30009, 40, 41, 31990],
      ids: items
    }];

    const eventHandler = (event, processedItems) => {
      this.resolveItem(event.id, event);
      processedItems.add(event.id);
    };

    return this._createSubscriptionPromise(items, this.relayUrls, filter, eventHandler);
  }

  onBatchError(items, error) {
    console.error("ETag batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}

export class ATagReferenceProcessor extends BatchProcessor {
  constructor(options = {}) {
    super({
      pool: options.pool,
      batchSize: options.batchSize || 50,
      batchDelay: options.batchDelay || 100,
    });
    this.relayUrls = [];
  }

  setRelayUrls(urls) {
    this.relayUrls = Array.isArray(urls) ? urls : [];
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

  onBatchError(items, error) {
    console.error("ATag batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}

export class ProfileProcessor extends BatchProcessor {
  constructor(options = {}) {
    const { simplePool, config } = options;
    if (!simplePool?.ensureRelay) {
      throw new Error('Invalid simplePool: ensureRelay method is required');
    }

    super({
      pool: simplePool,
      batchSize: config.BATCH_SIZE,
      batchDelay: config.BATCH_DELAY,
      relayUrls: config.RELAYS
    });
    
    this.config = config;
  }

  async onBatchProcess(pubkeys) {
    if (!this.config.RELAYS?.length) {
      throw new Error('No relays configured for profile fetch');
    }

    const filter = [{
      kinds: [0],
      authors: pubkeys
    }];

    const eventHandler = (event, processedItems) => {
      if (!processedItems.has(event.pubkey)) {
        console.log(`Received profile event for pubkey ${event.pubkey}:`, event);
        this.resolveItem(event.pubkey, event);
        processedItems.add(event.pubkey);
      }
    };

    try {
      await this._createSubscriptionPromise(
        pubkeys,
        this.config.RELAYS,
        filter,
        eventHandler
      );
    } catch (error) {
      console.error("Profile fetch error:", error);
      this.onBatchError(pubkeys, error);
    }
  }

  onBatchError(items, error) {
    console.error("Profile batch processing error:", error);
    items.forEach(pubkey => this.resolveItem(pubkey, null));
  }
}