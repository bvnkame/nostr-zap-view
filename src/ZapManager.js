import { zapPool } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats } from "./UIManager.js";
import { decodeIdentifier, fetchZapStats } from "./utils.js";

const CONFIG = {
  SUBSCRIPTION_TIMEOUT: 20000,
  DEFAULT_LIMIT: 1,
  ERROR_MESSAGES: {
    DIALOG_NOT_FOUND: "Zapダイアログが見つかりません",
    BUTTON_NOT_FOUND: "取得ボタンが見つかりません",
    DECODE_FAILED: "識別子のデコードに失敗しました",
  },
};

class ZapConfig {
  constructor(identifier, maxCount, relayUrls) {
    this.identifier = identifier;
    this.maxCount = maxCount;
    this.relayUrls = relayUrls;
  }

  static fromButton(button) {
    if (!button) throw new Error(CONFIG.ERROR_MESSAGES.BUTTON_NOT_FOUND);
    return new ZapConfig(button.getAttribute("data-identifier"), parseInt(button.getAttribute("data-max-count"), 10), button.getAttribute("data-relay-urls").split(","));
  }
}

class ZapSubscriptionManager {
  constructor() {
    this.zapEventsCache = [];
    this.zapStatsCache = new Map();
    this.subscriptions = {
      zap: null,
      realTime: null,
    };
    this.state = {
      isZapClosed: false,
      isInitialFetchComplete: false,
    };
  }

  clearCache() {
    this.zapEventsCache = [];
  }

  async getZapStats(identifier) {
    if (this.zapStatsCache.has(identifier)) {
      return this.zapStatsCache.get(identifier);
    }
    const stats = await fetchZapStats(identifier);
    if (stats) {
      this.zapStatsCache.set(identifier, stats);
    }
    return stats;
  }

  closeZapSubscription() {
    if (this.subscriptions.zap && !this.state.isZapClosed) {
      this.subscriptions.zap.close();
      this.state.isZapClosed = true;
    }
  }

  async handleZapEvent(event, maxCount) {
    if (this.state.isZapClosed) return;

    const existingZapIndex = this.zapEventsCache.findIndex((e) => e.id === event.id);
    if (existingZapIndex === -1) {
      this.zapEventsCache.push(event);
      this.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      const index = this.zapEventsCache.findIndex((e) => e.id === event.id);
      if (index < maxCount) {
        await replacePlaceholderWithZap(event, index);
      }

      if (this.zapEventsCache.length >= maxCount) {
        this.closeZapSubscription();
      }
    }
  }

  async handleRealTimeEvent(event) {
    if (!this.state.isInitialFetchComplete) return;

    if (!this.zapEventsCache.some((e) => e.id === event.id)) {
      this.zapEventsCache.unshift(event);
      await prependZap(event);
    }
  }

  async initializeSubscriptions(config) {
    const decoded = decodeIdentifier(config.identifier, config.maxCount);
    if (!decoded) throw new Error(CONFIG.ERROR_MESSAGES.DECODE_FAILED);

    this.closeZapSubscription();
    this.state.isZapClosed = false;

    this.subscriptions.zap = this.createZapSubscription(config, decoded);
    setTimeout(() => this.closeZapSubscription(), CONFIG.SUBSCRIPTION_TIMEOUT);
  }

  createZapSubscription(config, decoded) {
    return zapPool.subscribeMany(config.relayUrls, [{ ...decoded.req }], {
      onevent: (event) => this.handleZapEvent(event, config.maxCount),
      oneose: () => {
        this.state.isInitialFetchComplete = true;
        this.initializeRealTimeSubscription(config);
      },
    });
  }

  initializeRealTimeSubscription(config) {
    if (this.subscriptions.realTime) return;

    const decoded = decodeIdentifier(config.identifier, CONFIG.DEFAULT_LIMIT);
    if (!decoded) throw new Error(CONFIG.ERROR_MESSAGES.DECODE_FAILED);

    this.subscriptions.realTime = zapPool.subscribeMany(
      config.relayUrls,
      [
        {
          ...decoded.req,
          limit: CONFIG.DEFAULT_LIMIT,
          since: Math.floor(Date.now() / 1000),
        },
      ],
      {
        onevent: (event) => this.handleRealTimeEvent(event),
        oneose: () => console.log("リアルタイムZapのEOSEを受信。"),
      }
    );
  }
}

const subscriptionManager = new ZapSubscriptionManager();

export async function fetchLatestZaps() {
  try {
    const zapDialog = document.querySelector("zap-dialog");
    if (!zapDialog) throw new Error(CONFIG.ERROR_MESSAGES.DIALOG_NOT_FOUND);

    const config = ZapConfig.fromButton(document.querySelector("button[data-identifier]"));
    const hasCache = subscriptionManager.zapEventsCache.length > 0;

    if (!hasCache) {
      subscriptionManager.clearCache();
    }

    showDialog();

    if (hasCache) {
      await renderZapListFromCache(subscriptionManager.zapEventsCache, config.maxCount);
      const stats = await subscriptionManager.getZapStats(config.identifier);
      if (stats) displayZapStats(stats);
    } else {
      await initializeNewFetch(config);
    }
  } catch (error) {
    console.error("Zap取得中にエラーが発生しました:", error);
  }
}

async function initializeNewFetch(config) {
  initializeZapPlaceholders(config.maxCount);
  initializeZapStats();

  const [zapStats] = await Promise.all([subscriptionManager.getZapStats(config.identifier), subscriptionManager.initializeSubscriptions(config)]);

  if (zapStats) displayZapStats(zapStats);
}
