import { API_CONFIG } from "./ZapConfig.js";
import { displayZapStats } from "./UIManager.js";

export class StatsManager {
  constructor() {
    this.viewStatsCache = new Map();
  }

  getOrCreateViewCache(viewId) {
    if (!this.viewStatsCache.has(viewId)) {
      this.viewStatsCache.set(viewId, new Map());
    }
    return this.viewStatsCache.get(viewId);
  }

  async getZapStats(identifier, viewId) {
    const viewCache = this.getOrCreateViewCache(viewId);
    const cached = viewCache.get(identifier);
    const now = Date.now();

    if (cached && now - cached.timestamp < API_CONFIG.CACHE_DURATION) {
      return cached.stats;
    }

    const stats = await this.fetchStats(identifier);
    if (stats) {
      this.updateCache(viewId, identifier, stats);
    }
    return stats;
  }

  updateCache(viewId, identifier, stats) {
    const viewCache = this.getOrCreateViewCache(viewId);
    viewCache.set(identifier, {
      stats,
      timestamp: Date.now(),
    });
  }

  async fetchStats(identifier) {
    try {
      const response = await this._fetchFromApi(identifier);
      const stats = this._formatStats(response);
      return stats || this.createTimeoutError();
    } catch (error) {
      return this.handleFetchError(error);
    }
  }

  createTimeoutError() {
    return { error: true, timeout: true };
  }

  handleFetchError(error) {
    console.error("Failed to fetch Zap stats:", error);
    return {
      error: true,
      timeout: error.message === "STATS_TIMEOUT",
    };
  }

  async _fetchFromApi(identifier) {
    const decoded = window.NostrTools.nip19.decode(identifier);
    const isProfile = decoded.type === "npub" || decoded.type === "nprofile";
    const endpoint = `https://api.nostr.band/v0/stats/${
      isProfile ? "profile" : "event"
    }/${identifier}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      API_CONFIG.REQUEST_TIMEOUT
    );

    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      return response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("STATS_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _formatStats(responseData) {
    if (!responseData?.stats) return null;

    const stats = Object.values(responseData.stats)[0];
    if (!stats) return null;

    const formattedStats = {
      count: parseInt(stats.zaps_received?.count || stats.zaps?.count || 0, 10),
      msats: parseInt(stats.zaps_received?.msats || stats.zaps?.msats || 0, 10),
      maxMsats: parseInt(
        stats.zaps_received?.max_msats || stats.zaps?.max_msats || 0,
        10
      ),
    };

    return formattedStats;
  }

  async handleCachedZaps(viewId, config) {
    const viewState = this.getOrCreateViewState(viewId);
    try {
      if (!viewState.currentStats) {
        const stats = await this.getZapStats(config.identifier, viewId);
        // 初期データはそのまま使用
        viewState.currentStats = stats?.error ? { timeout: stats.timeout } : stats;
      }

      displayZapStats(viewState.currentStats, viewId);
      await renderZapListFromCache(
        viewState.zapEventsCache,
        config.maxCount,
        viewId
      );
    } catch (error) {
      console.error("Failed to handle cached zaps:", error);
      displayZapStats({ timeout: true }, viewId);
    }
  }

  async initializeStats(identifier, viewId) {
    try {
      const stats = await this.getZapStats(identifier, viewId);
      const initialStats = stats?.error ? { timeout: true } : stats;
      this.displayStats(initialStats, viewId);
      return initialStats;
    } catch (error) {
      console.error("Failed to fetch initial stats:", error);
      this.displayStats({ timeout: true }, viewId);
      return { error: true, timeout: true };
    }
  }

  async handleZapEvent(event, state, viewId) {
    const amountMsats = this.extractAmountFromBolt11(
      event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1]
    );

    if (amountMsats <= 0) return;

    // リアルタイムイベントの場合のみ現在の統計情報に加算
    if (event.isRealTimeEvent) {
      // 統計情報が未初期化の場合は初期化
      if (!state.currentStats || state.currentStats.error) {
        state.currentStats = await this.getZapStats(this.getViewIdentifier(viewId), viewId) || {
          count: 0,
          msats: 0,
          maxMsats: 0
        };
      }

      // 現在の統計情報に加算
      state.currentStats = {
        count: state.currentStats.count + 1,
        msats: state.currentStats.msats + amountMsats,
        maxMsats: Math.max(state.currentStats.maxMsats, amountMsats)
      };

      // キャッシュとUIを更新
      this.updateCache(viewId, this.getViewIdentifier(viewId), state.currentStats);
      this.displayStats(state.currentStats, viewId);
    }

    event.isStatsCalculated = true;
    event.amountMsats = amountMsats;
  }

  // 新しくビューの識別子を取得するメソッドを追加
  getViewIdentifier(viewId) {
    const viewCache = this.getOrCreateViewCache(viewId);
    return Array.from(viewCache.keys())[0];
  }

  extractAmountFromBolt11(bolt11) {
    try {
      const decoded = window.decodeBolt11(bolt11);
      return parseInt(
        decoded.sections.find((section) => section.name === "amount")?.value ??
          "0",
        10
      );
    } catch (error) {
      console.error("Failed to decode bolt11:", error);
      return 0;
    }
  }

  displayStats(stats, viewId) {
    displayZapStats(stats, viewId);
  }
}

export const statsManager = new StatsManager();
