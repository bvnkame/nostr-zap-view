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
  }

  async getZapStats(identifier, viewId) {
    const state = this.getOrCreateViewState(viewId);
    const cached = state.zapStatsCache.get(identifier);
    const now = Date.now();

    // Return cache if valid
    if (cached && now - cached.timestamp < 300000) { // 5 minutes
      return cached.stats;
    }

    const stats = await fetchZapStats(identifier);
    if (stats) {
      state.zapStatsCache.set(identifier, {
        stats,
        timestamp: now,
      });
      state.currentStats = { ...stats }; // Keep current stats
    }
    return stats;
  }

  async updateStatsFromZapEvent(event, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.currentStats) return;

    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      if (!bolt11Tag) return;

      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsat = decoded.sections.find((section) => section.name === "amount")?.value;

      if (amountMsat) {
        state.currentStats.count++;
        state.currentStats.msats += Math.floor(amountMsat / 1000) * 1000;
        state.currentStats.maxMsats = Math.max(state.currentStats.maxMsats, amountMsat);
        displayZapStats(state.currentStats);
      }
    } catch (error) {
      console.error("Failed to update Zap stats:", error);
    }
  }

  async handleZapEvent(event, maxCount, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
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
      state.zapEventsCache.unshift(event);
      await Promise.all([
        prependZap(event, viewId), // Add viewId parameter
        this.updateStatsFromZapEvent(event, viewId)
      ]);
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

    if (!hasCache) {
      subscriptionManager.clearCache(viewId);
    }

    showDialog(viewId);

    await (hasCache ? handleCachedZaps(viewId, config) : initializeNewFetch(viewId, config));

    if (viewState.zapEventsCache.length === 0) {
      showNoZapsMessage(viewId);
    }
  } catch (error) {
    console.error("Error occurred while fetching Zaps:", error);
  }
}

async function handleCachedZaps(viewId, config) {
  const viewState = subscriptionManager.getOrCreateViewState(viewId);
  // Start fetching stats first
  const statsPromise = subscriptionManager.getZapStats(config.identifier, viewId);

  // Render UI in parallel
  await renderZapListFromCache(viewState.zapEventsCache, config.maxCount);

  // Wait for stats to be fetched
  const stats = await statsPromise;
  if (stats) displayZapStats(stats);
}

async function initializeNewFetch(viewId, config) {
  initializeZapPlaceholders(config.maxCount, viewId); // Fix: Add viewId
  initializeZapStats(viewId); // Fix: Add viewId

  const [zapStats] = await Promise.all([
    subscriptionManager.getZapStats(config.identifier, viewId),
    subscriptionManager.initializeSubscriptions(config, viewId)
  ]);

  if (zapStats) displayZapStats(zapStats, viewId); // Fix: Add viewId
}
