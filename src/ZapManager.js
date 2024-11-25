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

  async updateStatsFromZapEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.currentStats) {
      state.currentStats = { count: 0, msats: 0, maxMsats: 0 };
    }

    const amountMsats = statsManager.extractAmountFromEvent(event);
    if (amountMsats > 0) {
      state.currentStats = statsManager.updateStats(state.currentStats, amountMsats);
      displayZapStats(state.currentStats, viewId);
    }
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
      state.zapEventsCache.unshift(event);

      try {
        const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
        if (bolt11Tag) {
          const decoded = window.decodeBolt11(bolt11Tag);
          const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value ?? "0", 10);

          if (amountMsats > 0) {
            // currentStatsが未定義の場合は初期化
            if (!state.currentStats) {
              state.currentStats = {
                count: 0,
                msats: 0,
                maxMsats: 0
              };
            }

            // 統計情報を更新（`||`を使用せず直接加算）
            state.currentStats.count += 1;
            state.currentStats.msats += amountMsats;
            state.currentStats.maxMsats = Math.max(state.currentStats.maxMsats, amountMsats);

            displayZapStats(state.currentStats, viewId);
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

    // 初期化時にキャッシュをクリア
    const state = this.getOrCreateViewState(viewId);
    state.isInitialFetchComplete = false;

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

  async updateStatsFromCachedEvents(viewState, stats) {
    viewState.currentStats = {
      count: stats?.count ?? 0,
      msats: stats?.msats ?? 0,
      maxMsats: stats?.maxMsats ?? 0
    };

    // リアルタイムフラグが付いているイベントのみを処理
    const realtimeEvents = viewState.zapEventsCache.filter(event => event.isRealTimeEvent);

    for (const event of realtimeEvents) {
      try {
        const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
        if (!bolt11Tag) continue;

        const decoded = window.decodeBolt11(bolt11Tag);
        const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value ?? "0", 10);

        if (amountMsats > 0) {
          viewState.currentStats = {
            count: viewState.currentStats.count + 1,
            msats: viewState.currentStats.msats + amountMsats,
            maxMsats: Math.max(viewState.currentStats.maxMsats, amountMsats)
          };
        }
      } catch (error) {
        console.error("Failed to process cached Zap event:", error);
      }
    }

    return viewState.currentStats;
  }

  async handleCachedZaps(viewId, config) {
    const viewState = subscriptionManager.getOrCreateViewState(viewId);
    const stats = await statsManager.getZapStats(config.identifier, viewId); // statsManagerを使用するように変更
    
    if (!stats?.error) {
      // リアルタイムイベントを含むすべてのZapイベントから統計を再計算
      const updatedStats = await recalculateStatsFromAllEvents(viewState, stats);
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
  const stats = await statsManager.getZapStats(config.identifier, viewId); // statsManagerを使用するように変更
  
  if (!stats?.error) {
    // リアルタイムイベントを含むすべてのZapイベントから統計を再計算
    const updatedStats = await recalculateStatsFromAllEvents(viewState, stats);
    displayZapStats(updatedStats, viewId);
  } else {
    displayZapStats({ timeout: stats.timeout }, viewId);
  }

  await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
}

// 新しい関数: すべてのZapイベントから統計を再計算
async function recalculateStatsFromAllEvents(viewState, baseStats) {
  // 基本の統計情報を初期化（nostr.bandからの統計）
  let currentStats = {
    count: baseStats?.count || 0,
    msats: baseStats?.msats || 0,
    maxMsats: baseStats?.maxMsats || 0
  };

  // リアルタイムイベントのみを処理
  const realtimeEvents = viewState.zapEventsCache.filter(event => event.isRealTimeEvent === true);

  for (const event of realtimeEvents) {
    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      if (!bolt11Tag) continue;

      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value || "0", 10);

      if (amountMsats > 0) {
        currentStats.count++;
        currentStats.msats += amountMsats;
        currentStats.maxMsats = Math.max(currentStats.maxMsats, amountMsats);
      }
    } catch (error) {
      console.error("Failed to process Zap event for stats:", error);
    }
  }

  // 更新された統計情報をキャッシュに保存
  viewState.currentStats = currentStats;
  return currentStats;
}

async function initializeNewFetch(viewId, config) {
  initializeZapPlaceholders(config.maxCount, viewId); // Fix: Add viewId
  initializeZapStats(viewId); // Fix: Add viewId

  // 統計情報の取得とサブスクリプションの初期化を並行実行
  const [zapStats, ] = await Promise.all([
    statsManager.getZapStats(config.identifier, viewId),
    subscriptionManager.initializeSubscriptions(config, viewId)
  ]);

  // 統計情報の表示（エラー時は代替表示）
  if (!zapStats?.error) {
    displayZapStats(zapStats, viewId);
  } else {
    displayZapStats({ timeout: zapStats.timeout }, viewId);
  }
}
