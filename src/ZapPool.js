import { SimplePool } from "nostr-tools";
import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

class ZapPoolManager {
  constructor() {
    this.zapPool = new SimplePool();
    this.profilePool = new SimplePool();
    this.subscriptions = { zap: null, realTime: null };
    this.state = { isZapClosed: false };
  }

  closeSubscription(type = 'zap') {
    if (this.subscriptions[type] && !this.state.isZapClosed) {
      this.subscriptions[type].close();
      if (type === 'zap') {
        this.state.isZapClosed = true;
      }
    }
  }

  subscribeToZaps(config, decoded, handlers) {
    this.closeSubscription('zap');
    this.state.isZapClosed = false;

    this.subscriptions.zap = this.zapPool.subscribeMany(
      config.relayUrls,
      [{ ...decoded.req }],
      handlers
    );

    // Set timeout to close subscription
    setTimeout(() => this.closeSubscription('zap'), CONFIG.SUBSCRIPTION_TIMEOUT);
  }

  subscribeToRealTime(config, decoded, handlers) {
    if (this.subscriptions.realTime) return;

    this.subscriptions.realTime = this.zapPool.subscribeMany(
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
