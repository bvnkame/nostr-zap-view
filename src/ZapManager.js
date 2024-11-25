import { poolManager } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats, showNoZapsMessage } from "./UIManager.js";
import { decodeIdentifier, fetchZapStats } from "./utils.js";
import { ZapConfig, ZAP_CONFIG as CONFIG } from "./ZapConfig.js";
import { statsManager } from "./StatsManager.js";

class ZapSubscriptionManager {
  constructor() {
    this.viewStates = new Map(); // 各ビューの状態を管理
  }

  getOrCreateViewState(viewId) {
    if (!this.viewStates.has(viewId)) {
      this.viewStates.set(viewId, {
        zapEventsCache: [],
        zapStatsCache: new Map(),
        isInitialFetchComplete: false,
        currentStats: null
      });
    }
    return this.viewStates.get(viewId);
  }

  clearCache(viewId) {
    const state = this.getOrCreateViewState(viewId);
    state.zapEventsCache = [];
    state.currentStats = null;  // Fix: currentStatsもクリア
  }

  async handleZapEvent(event, maxCount, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      event.isRealTimeEvent = false;
      state.zapEventsCache.push(event);
      state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      try {
        const index = state.zapEventsCache.findIndex((e) => e.id === event.id);
        if (index < maxCount) {
          await replacePlaceholderWithZap(event, index, viewId);
          await new Promise(resolve => setTimeout(resolve, 50));
          await renderZapListFromCache(state.zapEventsCache, maxCount, viewId);
        }
      } catch (error) {
        console.error("Failed to update Zap display:", error);
      }

      if (state.zapEventsCache.length >= maxCount) {
        poolManager.closeSubscription(viewId, 'zap');
      }
    }
  }

  async handleRealTimeEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.isInitialFetchComplete) return;

    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      event.isRealTimeEvent = true;
      event.isStatsCalculated = false; // 初期状態は未計算
      state.zapEventsCache.unshift(event);

      try {
        const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
        if (bolt11Tag) {
          const decoded = window.decodeBolt11(bolt11Tag);
          const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value ?? "0", 10);

          if (amountMsats > 0) {
            const updatedStats = await statsManager.incrementStats(state.currentStats, amountMsats, viewId);
            state.currentStats = updatedStats;
            displayZapStats(updatedStats, viewId);
            event.isStatsCalculated = true; // 計算済みフラグを設定
          }
        }

        await prependZap(event, viewId);
      } catch (error) {
        console.error("Failed to handle realtime Zap event:", error);
      }
    }
  }

  async initializeSubscriptions(config, viewId) {
    const decoded = decodeIdentifier(config.identifier, config.maxCount);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    const state = this.getOrCreateViewState(viewId);
    state.isInitialFetchComplete = false;

    // 統計情報の初期化
    state.currentStats = await statsManager.getZapStats(config.identifier, viewId);
    if (!state.currentStats?.error) {
      displayZapStats(state.currentStats, viewId);
    }

    return new Promise((resolve) => {
      poolManager.subscribeToZaps(viewId, config, decoded, {
        onevent: async (event) => {
          await this.handleZapEvent(event, config.maxCount, viewId);
        },
        oneose: () => {
          state.isInitialFetchComplete = true;
          this.initializeRealTimeSubscription(config, viewId);
          resolve();
        }
      });
    });
  }

  initializeRealTimeSubscription(config, viewId) {
    const decoded = decodeIdentifier(config.identifier, CONFIG.DEFAULT_LIMIT);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    poolManager.subscribeToRealTime(viewId, config, decoded, {
      onevent: (event) => this.handleRealTimeEvent(event, viewId),
      oneose: () => console.log("Received EOSE for real-time Zap.")
    });
  }

  async handleCachedZaps(viewId, config) {
    const viewState = subscriptionManager.getOrCreateViewState(viewId);
    const stats = await statsManager.getZapStats(config.identifier, viewId); // statsManagerを使用するように変更
    
    if (!stats?.error) {
      const updatedStats = await statsManager.recalculateStats(stats, viewState.zapEventsCache);
      displayZapStats(updatedStats, viewId);
    } else {
      displayZapStats({ timeout: stats.timeout }, viewId);
    }
  
    await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
  }
}

const subscriptionManager = new ZapSubscriptionManager();

export async function fetchLatestZaps(event) {
  try {
    const button = event.currentTarget;
    const viewId = button.getAttribute("data-zap-view-id");
    if (!viewId) throw new Error("Missing view ID");

    const zapDialog = document.querySelector(`nostr-zap-view-dialog[data-view-id="${viewId}"]`);
    if (!zapDialog) throw new Error(CONFIG.ERRORS.DIALOG_NOT_FOUND);

    const config = ZapConfig.fromButton(button);
    const viewState = subscriptionManager.getOrCreateViewState(viewId);
    const hasCache = viewState.zapEventsCache.length > 0;

    // Fix: キャッシュがある場合はクリアしない
    if (!hasCache) {
      subscriptionManager.clearCache(viewId);
    }

    showDialog(viewId);

    await (hasCache ? handleCachedZaps(viewId, config) : initializeNewFetch(viewId, config));

    // Only show "No Zaps" message if there are actually no zaps in the cache
    if (viewState.zapEventsCache.length === 0 && viewState.isInitialFetchComplete) {
      showNoZapsMessage(viewId);
    }
  } catch (error) {
    console.error("Error occurred while fetching Zaps:", error);
  }
}

async function handleCachedZaps(viewId, config) {
  const viewState = subscriptionManager.getOrCreateViewState(viewId);
  const stats = await statsManager.getZapStats(config.identifier, viewId);
  
  if (!stats?.error) {
    const updatedStats = await statsManager.recalculateStats(stats, viewState.zapEventsCache);
    displayZapStats(updatedStats, viewId);
  } else {
    displayZapStats({ timeout: stats.timeout }, viewId);
  }

  await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
}

// 新しい関数: すべてのZapイベントから統計を再計算
async function initializeNewFetch(viewId, config) {
  // プレースホルダーの初期化
  initializeZapPlaceholders(config.maxCount, viewId);
  initializeZapStats(viewId);

  // サブスクリプションをすぐに開始
  const subscriptionPromise = subscriptionManager.initializeSubscriptions(config, viewId);
  
  try {
    // 統計情報の取得を並行して実行
    const stats = await statsManager.getZapStats(config.identifier, viewId);
    displayZapStats(stats?.error ? { timeout: stats.timeout } : stats, viewId);
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    displayZapStats({ timeout: true }, viewId);
  }

  // サブスクリプションの���了を待機
  await subscriptionPromise;
}
