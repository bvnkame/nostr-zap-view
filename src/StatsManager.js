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

    if (cached && now - cached.timestamp < 300000) {
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
      return this._formatStats(response);
    } catch (error) {
      console.error("Failed to fetch Zap stats:", error);
      return { error: true, timeout: error.message === 'TIMEOUT' };
    }
  }

  async _fetchFromApi(identifier) {
    const decoded = window.NostrTools.nip19.decode(identifier);
    const isProfile = decoded.type === "npub" || decoded.type === "nprofile";
    const endpoint = `https://api.nostr.band/v0/stats/${isProfile ? "profile" : "event"}/${identifier}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      return response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('TIMEOUT');
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

    return {
      count: stats.zaps_received?.count || stats.zaps?.count || 0,
      msats: stats.zaps_received?.msats || stats.zaps?.msats || 0,
      maxMsats: stats.zaps_received?.max_msats || stats.zaps?.max_msats || 0,
    };
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
    // 基本の統計情報を初期化
    let stats = {
      count: baseStats?.count || 0,
      msats: baseStats?.msats || 0,
      maxMsats: baseStats?.maxMsats || 0
    };

    // リアルタイムイベントのみを処理
    const realtimeEvents = events.filter(event => event.isRealTimeEvent === true);

    for (const event of realtimeEvents) {
      const amountMsats = this.extractAmountFromEvent(event);
      if (amountMsats > 0) {
        stats.count++;
        stats.msats += amountMsats;
        stats.maxMsats = Math.max(stats.maxMsats, amountMsats);
      }
    }

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
}

export const statsManager = new StatsManager();