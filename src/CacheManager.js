export class CacheManager {
  static instance = null;
  
  constructor() {
    if (CacheManager.instance) {
      return CacheManager.instance;
    }
    this.referenceCache = new Map();
    this.zapInfoCache = new Map();
    this.uiComponentCache = new Map();
    CacheManager.instance = this;
  }

  // Reference cache methods
  setReference(eventId, reference) {
    this.referenceCache.set(eventId, reference);
  }

  getReference(eventId) {
    return this.referenceCache.get(eventId);
  }

  // ZapInfo cache methods
  setZapInfo(eventId, info) {
    this.zapInfoCache.set(eventId, info);
  }

  getZapInfo(eventId) {
    return this.zapInfoCache.get(eventId);
  }

  // UI Component cache methods
  setUIComponent(referenceId, html) {
    this.uiComponentCache.set(referenceId, html);
  }

  getUIComponent(referenceId) {
    return this.uiComponentCache.get(referenceId);
  }

  // Clear methods
  clearAll() {
    this.referenceCache.clear();
    this.zapInfoCache.clear();
    this.uiComponentCache.clear();
  }

  clearReference(eventId) {
    this.referenceCache.delete(eventId);
  }

  clearZapInfo(eventId) {
    this.zapInfoCache.delete(eventId);
  }

  clearUIComponent(referenceId) {
    this.uiComponentCache.delete(referenceId);
  }
}

export const cacheManager = new CacheManager();
