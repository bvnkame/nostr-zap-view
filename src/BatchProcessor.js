export class BatchProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.batchDelay = options.batchDelay || 100;
    this.batchQueue = new Set();
    this.pendingFetches = new Map();
    this.resolvers = new Map();
    this.processingItems = new Set();
    this.batchTimer = null;
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
    throw new Error("_getSubscriptionPool must be implemented by derived class");
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
}

export class ETagReferenceProcessor extends BatchProcessor {
  constructor(pool, options = {}) {
    super({
      batchSize: options.batchSize || 50,
      batchDelay: options.batchDelay || 100,
    });
    this.pool = pool;
    this.relayUrls = [];
  }

  setRelayUrls(urls) {
    this.relayUrls = Array.isArray(urls) ? urls : [];
  }

  _getSubscriptionPool() {
    return this.pool.zapPool;
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
  constructor(pool, options = {}) {
    super({
      batchSize: options.batchSize || 50,
      batchDelay: options.batchDelay || 100,
    });
    this.pool = pool;
    this.relayUrls = [];
  }

  setRelayUrls(urls) {
    this.relayUrls = Array.isArray(urls) ? urls : [];
  }

  _getSubscriptionPool() {
    return this.pool.zapPool;
  }

  async onBatchProcess(items) {
    const filter = items.map(aTagValue => ({ '#a': [aTagValue] }));

    const eventHandler = (event, processedItems) => {
      const aTagValue = event.tags.find(t => t[0] === 'a')?.[1];
      if (aTagValue) {
        this.resolveItem(aTagValue, event);
        processedItems.add(aTagValue);
      }
    };

    return this._createSubscriptionPromise(items, this.relayUrls, filter, eventHandler);
  }

  onBatchError(items, error) {
    console.error("ATag batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}

export class ProfileProcessor extends BatchProcessor {
  constructor({ profilePool, config }) {
    super({
      batchSize: config.BATCH_SIZE || 50,
      batchDelay: config.BATCH_DELAY || 100,
    });
    this.profilePool = profilePool;
    this.config = config;
  }

  _getSubscriptionPool() {
    return this.profilePool;
  }

  async onBatchProcess(items) {
    const filter = [{
      kinds: [0],
      authors: items
    }];

    const eventHandler = (event, processedItems) => {
      this.resolveItem(event.pubkey, event);
      processedItems.add(event.pubkey);
    };

    return this._createSubscriptionPromise(items, this.config.RELAYS, filter, eventHandler);
  }

  onBatchError(items, error) {
    console.error("Profile batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}