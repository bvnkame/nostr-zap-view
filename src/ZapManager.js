import { poolManager } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats, showNoZapsMessage } from "./UIManager.js";
import { decodeIdentifier, fetchZapStats } from "./utils.js";
import { ZapConfig, ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

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

  async getZapStats(identifier, viewId) {
    const state = this.getOrCreateViewState(viewId);
    const cached = state.zapStatsCache.get(identifier);
    const now = Date.now();

    // Return cache if valid
    if (cached && now - cached.timestamp < 300000) { // 5 minutes
      state.currentStats = {
        count: cached.stats.count || 0,
        msats: cached.stats.msats || 0,
        maxMsats: cached.stats.maxMsats || 0
      };
      return cached.stats;
    }

    const stats = await fetchZapStats(identifier);
    if (stats) {
      state.zapStatsCache.set(identifier, {
        stats,
        timestamp: now,
      });
      state.currentStats = {
        count: stats.count || 0,
        msats: stats.msats || 0,
        maxMsats: stats.maxMsats || 0
      };
    }
    return stats;
  }

  async updateStatsFromZapEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    // statsの初期化を確実に行う
    if (!state.currentStats) {
      state.currentStats = {
        count: 0,
        msats: 0,
        maxMsats: 0
      };
    }

    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      if (!bolt11Tag) return;

      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value || "0", 10);

      if (amountMsats > 0) {
        state.currentStats = {
          count: state.currentStats.count + 1,
          msats: state.currentStats.msats + amountMsats,
          maxMsats: Math.max(state.currentStats.maxMsats, amountMsats)
        };

        displayZapStats(state.currentStats, viewId);
      }
    } catch (error) {
      console.error("Failed to update Zap stats:", error);
    }
  }

  async handleZapEvent(event, maxCount, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      // 履歴データはisRealTimeEventをfalseに設定
      event.isRealTimeEvent = false;
      state.zapEventsCache.push(event);

      // Sort by creation date
      state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);

      // Get index and display if within maxCount
      const index = state.zapEventsCache.findIndex((e) => e.id === event.id);
      if (index < maxCount) {
        try {
          await replacePlaceholderWithZap(event, index, viewId); // Add viewId parameter

          // Re-render if index might have changed
          if (index < maxCount) {
            await renderZapListFromCache(state.zapEventsCache, maxCount, viewId); // Add viewId parameter
          }
        } catch (error) {
          console.error("Failed to update Zap display:", error);
        }
      }

      if (state.zapEventsCache.length >= maxCount) {
        poolManager.closeSubscription(viewId, 'zap'); // Add viewId parameter
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
          const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value || "0", 10);

          if (amountMsats > 0) {
            // currentStatsの初期化を確認
            if (!state.currentStats) {
              state.currentStats = {
                count: 0,
                msats: 0,
                maxMsats: 0
              };
            }

            // 統計情報を更新
            state.currentStats = {
              count: state.currentStats.count + 1,
              msats: state.currentStats.msats + amountMsats,
              maxMsats: Math.max(state.currentStats.maxMsats, amountMsats)
            };

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

    poolManager.subscribeToZaps(viewId, config, decoded, {
      onevent: (event) => this.handleZapEvent(event, config.maxCount, viewId),
      oneose: () => {
        const state = this.getOrCreateViewState(viewId);
        state.isInitialFetchComplete = true;
        this.initializeRealTimeSubscription(config, viewId);
      }
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
      count: stats?.count || 0,
      msats: stats?.msats || 0,
      maxMsats: stats?.maxMsats || 0
    };

    // リアルタイムフラグが付いているイベントのみを処理
    const realtimeEvents = viewState.zapEventsCache.filter(event => event.isRealTimeEvent);

    for (const event of realtimeEvents) {
      try {
        const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
        if (!bolt11Tag) continue;

        const decoded = window.decodeBolt11(bolt11Tag);
        const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value || "0", 10);

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
}

const subscriptionManager = new ZapSubscriptionManager();

export async function fetchLatestZaps(event) {
  try {
    const button = event.currentTarget;
    const viewId = button.getAttribute("data-zap-view-id");
    if (!viewId) throw new Error("Missing view ID");

    const zapDialog = document.querySelector(`zap-dialog[data-view-id="${viewId}"]`);
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
  const stats = await subscriptionManager.getZapStats(config.identifier, viewId);
  
  // 統計情報の表示とイベントの表示を分離
  if (!stats?.error) {
    const updatedStats = await subscriptionManager.updateStatsFromCachedEvents(viewState, stats);
    displayZapStats(updatedStats, viewId);
  } else {
    displayZapStats({ timeout: stats.timeout }, viewId); // タイムアウト表示用
  }

  // Zapイベントのレンダリングは統計情報のエラーに関係なく実行
  await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
}

async function initializeNewFetch(viewId, config) {
  initializeZapPlaceholders(config.maxCount, viewId); // Fix: Add viewId
  initializeZapStats(viewId); // Fix: Add viewId

  // 統計情報の取得とサブスクリプションの初期化を並行実行
  const [zapStats, ] = await Promise.all([
    subscriptionManager.getZapStats(config.identifier, viewId),
    subscriptionManager.initializeSubscriptions(config, viewId)
  ]);

  // 統計情報の表示（エラー時は代替表示）
  if (!zapStats?.error) {
    displayZapStats(zapStats, viewId);
  } else {
    displayZapStats({ timeout: zapStats.timeout }, viewId);
  }
}
