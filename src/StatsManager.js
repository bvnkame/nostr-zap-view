import { API_CONFIG } from "./AppSettings.js";
import { displayZapStats } from "./UIManager.js";
import { safeNip19Decode } from "./utils.js";
import { cacheManager } from "./CacheManager.js"; // Add import

export class StatsManager {
  constructor() {
    // キャッシュ関連のプロパティを削除
  }

  async getZapStats(identifier, viewId) {
    const cached = await this.handleCachedStats(viewId, identifier);
    if (cached) {
      return cached;
    }

    const stats = await this.fetchStats(identifier);
    if (stats) {
      cacheManager.updateStatsCache(viewId, identifier, stats);
      // viewStateも更新
      cacheManager.updateViewState(viewId, { currentStats: stats });
    }
    return stats;
  }

  // updateCacheメソッドを削除（代わりにcacheManager.updateStatsCacheを使用）

  async fetchStats(identifier) {
    try {
      const response = await this._fetchFromApi(identifier);
      console.log("Fetched Zap stats:", response);
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
    const decoded = safeNip19Decode(identifier);
    if (!decoded) return null;
    
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

  async handleCachedStats(viewId, identifier) {
    const cached = cacheManager.getCachedStats(viewId, identifier);
    const now = Date.now();

    if (cached && now - cached.timestamp < API_CONFIG.CACHE_DURATION) {
      // viewStateを更新
      const viewState = cacheManager.getOrCreateViewState(viewId);
      viewState.currentStats = cached.stats;
      cacheManager.updateViewState(viewId, { currentStats: cached.stats });
      return cached.stats;
    }

    return null;
  }

  async initializeStats(identifier, viewId) {
    try {
      // キャッシュをチェック
      const cached = await this.handleCachedStats(viewId, identifier);
      if (cached) {
        displayZapStats(cached, viewId);
        return cached;
      }

      // キャッシュがない場合は新規取得
      const stats = await this.getZapStats(identifier, viewId);
      const initialStats = stats?.error ? { timeout: stats.timeout } : stats;
      
      if (!stats?.error) {
        const viewState = cacheManager.getOrCreateViewState(viewId);
        viewState.currentStats = initialStats;
        cacheManager.updateStatsCache(viewId, identifier, initialStats);
      }
      displayZapStats(initialStats, viewId);
      
      return initialStats;
    } catch (error) {
      console.error("Failed to fetch initial stats:", error);
      displayZapStats({ timeout: true }, viewId);
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
        state.currentStats = await this.getZapStats(cacheManager.getViewIdentifier(viewId), viewId) || {
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
      cacheManager.updateStatsCache(viewId, cacheManager.getViewIdentifier(viewId), state.currentStats);
      this.displayStats(state.currentStats, viewId);
    }

    event.isStatsCalculated = true;
    event.amountMsats = amountMsats;
  }

  extractAmountFromBolt11(bolt11) {
    try {
      const decoded = window.decodeBolt11(bolt11);
      return parseInt(
        decoded.sections.find((section) => section.name === "amount")?.value ?? "0",
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
