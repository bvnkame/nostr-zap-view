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