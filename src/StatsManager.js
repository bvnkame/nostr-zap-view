import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

export class StatsManager {
  constructor() {
    this.statsCache = new Map();
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

    if (cached && now - cached.timestamp < CONFIG.STATS_CACHE_DURATION) {
      return cached.stats;
    }

    const stats = await this.fetchStats(identifier);

    if (stats) {
      viewCache.set(identifier, {
        stats,
        timestamp: now,
      });
    }
    return stats;
  }

  async fetchStats(identifier) {
    try {
      const response = await this._fetchFromApi(identifier);
      const stats = this._formatStats(response);
      // statsがnullの場合はタイムアウトエラーを返す
      return stats || { error: true, timeout: true };
    } catch (error) {
      console.error("Failed to fetch Zap stats:", error);
      return { error: true, timeout: error.message === 'STATS_TIMEOUT' };
    }
  }

  async _fetchFromApi(identifier) {
    const decoded = window.NostrTools.nip19.decode(identifier);
    const isProfile = decoded.type === "npub" || decoded.type === "nprofile";
    const endpoint = `https://api.nostr.band/v0/stats/${isProfile ? "profile" : "event"}/${identifier}`;
    console.log("Fetching stats from:", endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.STATS_TIMEOUT);

    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      return response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('STATS_TIMEOUT');
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

    // 数値が未定義の場合は0として扱う
    return {
      count: parseInt(stats.zaps_received?.count || stats.zaps?.count || 0, 10),
      msats: parseInt(stats.zaps_received?.msats || stats.zaps?.msats || 0, 10),
      maxMsats: parseInt(stats.zaps_received?.max_msats || stats.zaps?.max_msats || 0, 10)
    };
  }

  async incrementStats(currentStats, amountMsats, viewId) {
    // タイムアウト状態の場合は統計を更新しない
    if (currentStats?.error && currentStats?.timeout) {
      return currentStats;
    }

    const updatedStats = {
      count: (currentStats?.count || 0) + 1,
      msats: (currentStats?.msats || 0) + amountMsats,
      maxMsats: Math.max(currentStats?.maxMsats || 0, amountMsats)
    };

    // キャッシュを更新
    const viewCache = this.getOrCreateViewCache(viewId);
    const identifier = Array.from(viewCache.keys())[0];
    if (identifier) {
      viewCache.set(identifier, {
        stats: updatedStats,
        timestamp: Date.now()
      });
    }

    return updatedStats;
  }

  updateStats(currentStats, amountMsats) {
    if (!currentStats) {
      return {
        count: 1,
        msats: amountMsats,
        maxMsats: amountMsats
      };
    }

    return {
      count: currentStats.count + 1,
      msats: currentStats.msats + amountMsats,
      maxMsats: Math.max(currentStats.maxMsats, amountMsats)
    };
  }

  recalculateStats(baseStats, events) {
    let stats = {
      count: baseStats?.count || 0,
      msats: baseStats?.msats || 0,
      maxMsats: baseStats?.maxMsats || 0
    };

    // 未計算のリアルタイムイベントのみを処理
    events.forEach(event => {
      if (event.isRealTimeEvent && !event.isStatsCalculated && event.amountMsats > 0) {
        stats.count++;
        stats.msats += event.amountMsats;
        stats.maxMsats = Math.max(stats.maxMsats, event.amountMsats);
        event.isStatsCalculated = true;
      }
    });

    return stats;
  }

  extractAmountFromEvent(event) {
    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      if (!bolt11Tag) return 0;

      const decoded = window.decodeBolt11(bolt11Tag);
      return parseInt(decoded.sections.find(section => section.name === "amount")?.value || "0", 10);
    } catch (error) {
      console.error("Failed to extract amount from event:", error);
      return 0;
    }
  }

  async handleCachedZaps(viewId, config) {
    const viewState = this.getOrCreateViewState(viewId);
    try {
      if (!viewState.currentStats) {
        const stats = await this.getZapStats(config.identifier, viewId);
        viewState.currentStats = !stats?.error 
          ? await this.recalculateStats(stats, viewState.zapEventsCache)
          : { timeout: stats.timeout };
      }
      
      displayZapStats(viewState.currentStats, viewId);
      await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
    } catch (error) {
      console.error("Failed to handle cached zaps:", error);
      displayZapStats({ timeout: true }, viewId);
    }
  }
}

export const statsManager = new StatsManager();