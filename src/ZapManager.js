import { zapPool } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats } from "./UIManager.js";
import { decodeIdentifier, fetchZapStats } from "./utils.js";
import { ZapConfig } from "./ZapConfig.js";

// 設定をグローバルな設定オブジェクトに統合
export const CONFIG = {
  ZAP: {
    SUBSCRIPTION_TIMEOUT: 20000,
    DEFAULT_LIMIT: 1,
  },
  ERRORS: {
    DIALOG_NOT_FOUND: "Zapダイアログが見つかりません",
    BUTTON_NOT_FOUND: "取得ボタンが見つかりません",
    DECODE_FAILED: "識別子のデコードに失敗しました",
  },
};

class ZapSubscriptionManager {
  constructor() {
    this.zapEventsCache = [];
    this.zapStatsCache = new Map();
    this.subscriptions = { zap: null, realTime: null };
    this.state = { isZapClosed: false, isInitialFetchComplete: false };
    this.currentStats = null; // 現在の統計情報を保持
  }

  clearCache() {
    this.zapEventsCache = [];
  }

  async getZapStats(identifier) {
    const cached = this.zapStatsCache.get(identifier);
    const now = Date.now();

    // キャッシュが有効な場合はそれを返す
    if (cached && now - cached.timestamp < 300000) {
      // 5分
      return cached.stats;
    }

    const stats = await fetchZapStats(identifier);
    if (stats) {
      this.zapStatsCache.set(identifier, {
        stats,
        timestamp: now,
      });
      this.currentStats = { ...stats }; // 現在の統計情報を保持
    }
    return stats;
  }

  async updateStatsFromZapEvent(event) {
    if (!this.currentStats) return;

    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      if (!bolt11Tag) return;

      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsat = decoded.sections.find((section) => section.name === "amount")?.value;

      if (amountMsat) {
        this.currentStats.count++;
        // millisatoshiからsatoshiに変換してから加算
        this.currentStats.msats += Math.floor(amountMsat / 1000) * 1000;
        this.currentStats.maxMsats = Math.max(this.currentStats.maxMsats, amountMsat);
        displayZapStats(this.currentStats);
      }
    } catch (error) {
      console.error("Zap統計の更新に失敗:", error);
    }
  }

  closeZapSubscription() {
    if (this.subscriptions.zap && !this.state.isZapClosed) {
      this.subscriptions.zap.close();
      this.state.isZapClosed = true;
    }
  }

  async handleZapEvent(event, maxCount) {
    if (this.state.isZapClosed) return;

    if (!this.zapEventsCache.some((e) => e.id === event.id)) {
      this.zapEventsCache.push(event);

      // 作成日時でソート
      this.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      // インデックスを取得し、maxCount以内の場合のみ表示
      const index = this.zapEventsCache.findIndex((e) => e.id === event.id);
      if (index < maxCount) {
        try {
          await replacePlaceholderWithZap(event, index);

          // インデックスが変わった可能性があるため、再描画
          if (index < maxCount) {
            await renderZapListFromCache(this.zapEventsCache, maxCount);
          }
        } catch (error) {
          console.error("Zap表示の更新に失敗:", error);
        }
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
      await Promise.all([prependZap(event), this.updateStatsFromZapEvent(event)]);
    }
  }

  async initializeSubscriptions(config) {
    const decoded = decodeIdentifier(config.identifier, config.maxCount);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    this.closeZapSubscription();
    this.state.isZapClosed = false;

    this.subscriptions.zap = this.createSubscription(config, decoded, {
      onevent: (event) => this.handleZapEvent(event, config.maxCount),
      oneose: () => {
        this.state.isInitialFetchComplete = true;
        this.initializeRealTimeSubscription(config);
      },
    });

    setTimeout(() => this.closeZapSubscription(), CONFIG.ZAP.SUBSCRIPTION_TIMEOUT);
  }

  createSubscription(config, decoded, handler) {
    return zapPool.subscribeMany(config.relayUrls, [{ ...decoded.req }], handler);
  }

  initializeRealTimeSubscription(config) {
    if (this.subscriptions.realTime) return;

    const decoded = decodeIdentifier(config.identifier, CONFIG.ZAP.DEFAULT_LIMIT);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    this.subscriptions.realTime = zapPool.subscribeMany(
      config.relayUrls,
      [
        {
          ...decoded.req,
          limit: CONFIG.ZAP.DEFAULT_LIMIT,
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
    if (!zapDialog) throw new Error(CONFIG.ERRORS.DIALOG_NOT_FOUND);

    const config = ZapConfig.fromButton(document.querySelector("button[data-identifier]"));
    const hasCache = subscriptionManager.zapEventsCache.length > 0;

    if (!hasCache) {
      subscriptionManager.clearCache();
    }

    showDialog();

    await (hasCache ? handleCachedZaps(config) : initializeNewFetch(config));
  } catch (error) {
    console.error("Zap取得中にエラーが発生しました:", error);
  }
}

async function handleCachedZaps(config) {
  // 統計情報の取得を先に開始
  const statsPromise = subscriptionManager.getZapStats(config.identifier);

  // UIの描画を並列で実行
  await renderZapListFromCache(subscriptionManager.zapEventsCache, config.maxCount);

  // 統計情報の取得完了を待つ
  const stats = await statsPromise;
  if (stats) displayZapStats(stats);
}

async function initializeNewFetch(config) {
  initializeZapPlaceholders(config.maxCount);
  initializeZapStats();

  const [zapStats] = await Promise.all([subscriptionManager.getZapStats(config.identifier), subscriptionManager.initializeSubscriptions(config)]);

  if (zapStats) displayZapStats(zapStats);
}
