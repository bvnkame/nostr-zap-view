import { SimplePool } from "nostr-tools/pool";
import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

class ZapPoolManager {
  constructor() {
    this.zapPool = new SimplePool();
    this.profilePool = new SimplePool();
    this.subscriptions = new Map(); // 複数のビューをサポートするためにMapに変更
    this.state = new Map(); // 状態も複数管理
  }

  closeSubscription(viewId, type = 'zap') {
    const subs = this.subscriptions.get(viewId);
    const state = this.state.get(viewId);
    
    if (subs?.[type] && !state?.isZapClosed) {
      subs[type].close();
      if (type === 'zap') {
        state.isZapClosed = true;
      }
    }
  }

  subscribeToZaps(viewId, config, decoded, handlers) {
    this.closeSubscription(viewId, 'zap');
    
    if (!this.subscriptions.has(viewId)) {
      this.subscriptions.set(viewId, { zap: null, realTime: null });
      this.state.set(viewId, { isZapClosed: false });
    }

    const state = this.state.get(viewId);
    state.isZapClosed = false;

    const subs = this.subscriptions.get(viewId);
    subs.zap = this.zapPool.subscribeMany(
      config.relayUrls,
      [{ ...decoded.req }],  // Fix: Make sure decoded.req is an array
      handlers
    );

    setTimeout(() => this.closeSubscription(viewId, 'zap'), CONFIG.SUBSCRIPTION_TIMEOUT);
  }

  subscribeToRealTime(viewId, config, decoded, handlers) {
    const subs = this.subscriptions.get(viewId);
    if (!subs || subs.realTime) return;  // Fix: Check if subs exists

    subs.realTime = this.zapPool.subscribeMany(
      config.relayUrls,
      [{
        ...decoded.req,
        limit: CONFIG.DEFAULT_LIMIT,
        since: Math.floor(Date.now() / 1000)
      }],
      handlers
    );
  }
}

export const poolManager = new ZapPoolManager();
export const { zapPool, profilePool } = poolManager;
