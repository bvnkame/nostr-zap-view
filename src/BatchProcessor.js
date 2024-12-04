// BaseクラスをDefaultエクスポートに変更
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
}

// 各ProcessorクラスはBaseクラスと同じファイルで定義
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

  async onBatchProcess(items) {
    if (!this.relayUrls.length) {
      items.forEach(id => this.resolveItem(id, null));
      return;
    }

    return new Promise((resolve) => {
      const processedEvents = new Set();
      let timeoutId;

      const sub = this.pool.zapPool.subscribeMany(
        this.relayUrls,
        [{
          kinds: [1, 30023, 30030, 30009, 40, 41, 31990],
          ids: items
        }],
        {
          onevent: (event) => {
            this.resolveItem(event.id, event);
            processedEvents.add(event.id);
          },
          oneose: () => {
            this._cleanup(timeoutId, sub, items, processedEvents);
            resolve();
          }
        }
      );

      timeoutId = setTimeout(() => {
        this._cleanup(timeoutId, sub, items, processedEvents);
        resolve();
      }, 5000);
    });
  }

  _cleanup(timeoutId, sub, items, processedEvents) {
    clearTimeout(timeoutId);
    if (sub) sub.close();
    items.forEach(item => {
      if (!processedEvents.has(item) && this.resolvers.has(item)) {
        this.resolveItem(item, null);
      }
    });
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

  async onBatchProcess(items) {
    if (!this.relayUrls.length) {
      items.forEach(id => this.resolveItem(id, null));
      return;
    }

    return new Promise((resolve) => {
      const processedEvents = new Set();
      let timeoutId;

      const sub = this.pool.zapPool.subscribeMany(
        this.relayUrls,
        items.map(aTagValue => ({ '#a': [aTagValue] })),
        {
          onevent: (event) => {
            const aTagValue = event.tags.find(t => t[0] === 'a')?.[1];
            if (aTagValue) {
              this.resolveItem(aTagValue, event);
              processedEvents.add(aTagValue);
            }
          },
          oneose: () => {
            this._cleanup(timeoutId, sub, items, processedEvents);
            resolve();
          }
        }
      );

      timeoutId = setTimeout(() => {
        this._cleanup(timeoutId, sub, items, processedEvents);
        resolve();
      }, 5000);
    });
  }

  _cleanup(timeoutId, sub, items, processedEvents) {
    clearTimeout(timeoutId);
    if (sub) sub.close();
    items.forEach(item => {
      if (!processedEvents.has(item) && this.resolvers.has(item)) {
        this.resolveItem(item, null);
      }
    });
  }

  onBatchError(items, error) {
    console.error("ATag batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}

export class ProfileProcessor extends BatchProcessor {
  constructor({ profilePool, config }) {  // 引数の構造を修正
    super({
      batchSize: config.BATCH_SIZE || 50,
      batchDelay: config.BATCH_DELAY || 100,
    });
    this.profilePool = profilePool;
    this.config = config;
  }

  async onBatchProcess(items) {
    if (!this.config?.RELAYS?.length) {
      console.warn("No profile relays configured");
      items.forEach(item => this.resolveItem(item, null));
      return;
    }

    return new Promise((resolve) => {
      const processedProfiles = new Set();
      let timeoutId;

      const sub = this.profilePool.subscribeMany(
        this.config.RELAYS,
        [{
          kinds: [0],
          authors: items
        }],
        {
          onevent: (event) => {
            this.resolveItem(event.pubkey, event);
            processedProfiles.add(event.pubkey);
          },
          oneose: () => {
            this._cleanup(timeoutId, sub, items, processedProfiles);
            resolve();
          }
        }
      );

      timeoutId = setTimeout(() => {
        this._cleanup(timeoutId, sub, items, processedProfiles);
        resolve();
      }, 5000);
    });
  }

  _cleanup(timeoutId, sub, items, processedProfiles) {
    clearTimeout(timeoutId);
    if (sub) sub.close();
    items.forEach(item => {
      if (!processedProfiles.has(item) && this.resolvers.has(item)) {
        this.resolveItem(item, null);
      }
    });
  }

  onBatchError(items, error) {
    console.error("Profile batch processing error:", error);
    items.forEach(item => this.resolveItem(item, null));
  }
}