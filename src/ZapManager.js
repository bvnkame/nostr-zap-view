import { zapPool } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats } from "./UIManager.js";
import { decodeIdentifier, fetchZapStats } from "./utils.js";

// 定数定義
const CONFIG = {
  SUBSCRIPTION_TIMEOUT: 20000,
  DEFAULT_LIMIT: 1,
};

// Zapイベントの購読と管理を担当するクラス
class SubscriptionManager {
  constructor() {
    this.zapEventsCache = [];
    this.zapSubscription = null;
    this.realTimeSubscription = null;
    this.isZapClosed = false;
    this.zapStatsCache = new Map(); // 統計情報のキャッシュを追加
    this.isInitialFetchComplete = false; // 初期取得の完了フラグを追加
  }

  // キャッシュをクリアするメソッドを修正
  clearCache() {
    this.zapEventsCache = []; // Zapイベントのみクリア
  }

  // 統計情報を取得（キャッシュがある場合はキャッシュから）
  async getZapStats(identifier) {
    if (this.zapStatsCache.has(identifier)) {
      console.log("キャッシュから統計情報を取得:", identifier);
      return this.zapStatsCache.get(identifier);
    }

    const stats = await fetchZapStats(identifier);
    if (stats) {
      console.log("統計情報をキャッシュに保存:", identifier);
      this.zapStatsCache.set(identifier, stats);
    }
    return stats;
  }

  // Zapサブスクリプションを閉じ、ダイアログを表示する
  closeZapSubscription() {
    if (this.zapSubscription && !this.isZapClosed) {
      this.zapSubscription.close();
      this.isZapClosed = true;
      console.log("Zapサブスクリプションを閉じました。");
    }
  }

  // 新しいZapイベントを処理し、キャッシュのみを更新
  async handleZapEvent(event, maxCount) {
    if (this.isZapClosed) return;

    // 既存のイベントをチェック
    const existingZapIndex = this.zapEventsCache.findIndex((e) => e.id === event.id);
    if (existingZapIndex === -1) {
      this.zapEventsCache.push(event);
      this.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      // インデックスを取得して、プレースホルダーと置き換え
      const index = this.zapEventsCache.findIndex((e) => e.id === event.id);
      if (index < maxCount) {
        await replacePlaceholderWithZap(event, index);
      }

      if (this.zapEventsCache.length >= maxCount) {
        this.closeZapSubscription();
      }
    }
  }

  // リアルタイムイベントの処理は初期取得完了後のみ実行
  async handleRealTimeEvent(event) {
    if (!this.isInitialFetchComplete) return;

    if (!this.zapEventsCache.some((e) => e.id === event.id)) {
      this.zapEventsCache.unshift(event);
      await prependZap(event);
    }
  }
}

const subscriptionManager = new SubscriptionManager();

// ボタンから設定を取得し、Zapの取得を開始する
export async function fetchLatestZaps() {
  try {
    const zapDialog = document.querySelector("zap-dialog");
    if (!zapDialog) throw new Error("Zap dialog not found");

    const fetchButton = document.querySelector("button[data-identifier]");
    if (!fetchButton) throw new Error("Fetch button not found");

    const config = {
      identifier: fetchButton.getAttribute("data-identifier"),
      maxCount: parseInt(fetchButton.getAttribute("data-max-count"), 10),
      relayUrls: fetchButton.getAttribute("data-relay-urls").split(","),
    };

    // キャッシュされたZapイベントがある場合は新規取得しない
    const hasCache = subscriptionManager.zapEventsCache.length > 0;

    if (!hasCache) {
      subscriptionManager.clearCache();
    }

    showDialog();

    if (hasCache) {
      // キャッシュからの表示
      await renderZapListFromCache(subscriptionManager.zapEventsCache, config.maxCount);
      const stats = await subscriptionManager.getZapStats(config.identifier);
      if (stats) {
        displayZapStats(stats);
      }
    } else {
      // 新規取得
      initializeZapPlaceholders(config.maxCount);
      initializeZapStats();

      const [zapStats] = await Promise.all([subscriptionManager.getZapStats(config.identifier), initializeSubscriptions(config)]);

      if (zapStats) {
        displayZapStats(zapStats);
      }
    }
  } catch (error) {
    console.error("Zap取得中にエラーが発生しました:", error);
  }
}

// 初期Zapとリアルタイムのサブスクリプションを設定する
async function initializeSubscriptions(config) {
  const decoded = decodeIdentifier(config.identifier, config.maxCount);
  if (!decoded) throw new Error("識別子のデコードに失敗しました。");

  if (subscriptionManager.zapSubscription && !subscriptionManager.isZapClosed) {
    subscriptionManager.closeZapSubscription();
  }
  subscriptionManager.isZapClosed = false;

  // 初期データの取得
  subscriptionManager.zapSubscription = zapPool.subscribeMany(config.relayUrls, [{ ...decoded.req }], {
    onevent: (event) => subscriptionManager.handleZapEvent(event, config.maxCount),
    oneose: () => {
      subscriptionManager.isInitialFetchComplete = true; // 初期取得完了をマーク
      initializeRealTimeSubscription(config); // リアルタイムサブスクリプションを開始
    },
  });

  setTimeout(() => subscriptionManager.closeZapSubscription(), CONFIG.SUBSCRIPTION_TIMEOUT);
}

// リアルタイムZap取得用のサブスクリプションを初期化する
function initializeRealTimeSubscription(config) {
  if (subscriptionManager.realTimeSubscription) return;

  const decoded = decodeIdentifier(config.identifier, CONFIG.DEFAULT_LIMIT);
  if (!decoded) throw new Error("リアルタイムサブスクリプション用の識別子のデコードに失敗しました。");

  subscriptionManager.realTimeSubscription = zapPool.subscribeMany(
    config.relayUrls,
    [
      {
        ...decoded.req,
        limit: CONFIG.DEFAULT_LIMIT,
        since: Math.floor(Date.now() / 1000),
      },
    ],
    {
      onevent: (event) => subscriptionManager.handleRealTimeEvent(event),
      oneose: () => console.log("リアルタイムZapのEOSEを受信。"),
    }
  );
}
