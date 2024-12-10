import { APP_CONFIG } from "./AppSettings.js";
import { displayZapStats } from "./UIManager.js";
import { safeNip19Decode } from "./utils.js";
import { cacheManager } from "./CacheManager.js"; // Add import

export class StatsManager {
  #currentStats = new Map();
  #initializationStatus = new Map();  // 追加: 初期化状態を追跡

  constructor() {
    // キャッシュ関連のプロパティを削除
  }

  async getZapStats(identifier, viewId) {
    console.time(`[Stats] Total getZapStats for ${viewId}`);
    console.debug('[Stats] Getting zap stats:', { identifier, viewId });
    const cached = await this.#checkCachedStats(viewId, identifier);
    if (cached) {
      console.debug('[Stats] Using cached stats:', cached);
      console.timeEnd(`[Stats] Total getZapStats for ${viewId}`);
      return cached;
    }

    console.debug('[Stats] Cache miss - fetching fresh stats');
    const stats = await this.fetchStats(identifier);
    if (stats) {
      console.debug('[Stats] Updating stats cache:', stats);
      cacheManager.updateStatsCache(viewId, identifier, stats);
    }
    console.timeEnd(`[Stats] Total getZapStats for ${viewId}`);
    return stats;
  }

  async fetchStats(identifier) {
    try {
      const response = await this._fetchFromApi(identifier);
      console.debug('[Stats] Fetched stats:', response);
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
    console.time(`[Stats] API fetch for ${identifier}`);
    const decoded = safeNip19Decode(identifier);
    if (!decoded) return null;

    const isProfile = decoded.type === "npub" || decoded.type === "nprofile";
    const endpoint = `https://api.nostr.band/v0/stats/${
      isProfile ? "profile" : "event"
    }/${identifier}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      APP_CONFIG.REQUEST_CONFIG.REQUEST_TIMEOUT
    );

    try {
      console.time('[Stats] Fetch request');
      const response = await fetch(endpoint, { signal: controller.signal });
      const data = await response.json();
      console.timeEnd('[Stats] Fetch request');
      console.timeEnd(`[Stats] API fetch for ${identifier}`);
      return data;
    } catch (error) {
      console.timeEnd(`[Stats] API fetch for ${identifier}`);
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

  async initializeStats(identifier, viewId, showSkeleton = false) {
    console.group(`[Stats] Initializing stats for ${viewId}`);
    console.debug('[Stats] Initialization request:', { identifier, viewId, showSkeleton });

    if (showSkeleton) {
      // スケルトン表示を即座に行う
      this.displayStats({ skeleton: true }, viewId);
    }

    if (this.#initializationStatus.has(viewId)) {
      console.debug('[Stats] Already initializing, returning existing promise');
      console.groupEnd();
      return this.#initializationStatus.get(viewId);
    }

    // キャッシュされた現在の統計情報をチェック
    const currentStats = this.getCurrentStats(viewId);
    console.debug('[Stats] Current stats in memory:', currentStats);

    const initPromise = (async () => {
      try {
        const stats = await this.getZapStats(identifier, viewId);
        console.debug('[Stats] Fetched/Retrieved stats:', stats);
        
        if (stats) {
          this.displayStats(stats, viewId);
          this.#currentStats.set(viewId, stats);
        }
        return stats;
      } catch (error) {
        console.error("[Stats] Initialization failed:", error);
        return null;
      } finally {
        this.#initializationStatus.delete(viewId);
        console.groupEnd();
      }
    })();

    this.#initializationStatus.set(viewId, initPromise);
    return initPromise;
  }

  async #checkCachedStats(viewId, identifier) {
    console.time('[Stats] Cache check');
    const cached = cacheManager.getCachedStats(viewId, identifier);
    const now = Date.now();

    if (cached) {
      const age = now - cached.timestamp;
      console.debug('[Stats] Cache details:', {
        age,
        isFresh: age < APP_CONFIG.REQUEST_CONFIG.CACHE_DURATION,
        stats: cached.stats,
        timestamp: new Date(cached.timestamp).toISOString()
      });
    }

    const result = cached && now - cached.timestamp < APP_CONFIG.REQUEST_CONFIG.CACHE_DURATION
      ? cached.stats
      : null;

    console.timeEnd('[Stats] Cache check');
    return result;
  }

  getCurrentStats(viewId) {
    return this.#currentStats.get(viewId);
  }

  async handleZapEvent(event, viewId, identifier) {
    // リアルタイムイベントでない場合は早期リターン
    if (!event?.isRealTimeEvent) {
      console.debug('[Stats] Ignoring non-realtime event:', { eventId: event?.id });
      return;
    }

    console.time(`[Stats] Process zap event ${event.id}`);
    try {
      const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
      console.debug('[Stats] Processing zap event:', { 
        eventId: event.id,
        bolt11: bolt11Tag?.substring(0, 20) + '...'
      });

      const amountMsats = this.extractAmountFromBolt11(bolt11Tag);
      console.debug('[Stats] Extracted amount:', { amountMsats });

      if (amountMsats <= 0) {
        console.debug('[Stats] Invalid amount, skipping');
        return;
      }

      console.time('[Stats] Stats calculation');
      const currentStats = cacheManager.getViewStats(viewId);
      console.debug('[Stats] Current stats:', currentStats);

      const baseStats = {
        count: currentStats?.count || 0,
        msats: currentStats?.msats || 0,
        maxMsats: currentStats?.maxMsats || 0
      };

      const updatedStats = {
        count: baseStats.count + 1,
        msats: baseStats.msats + amountMsats,
        maxMsats: Math.max(baseStats.maxMsats, amountMsats)
      };
      console.timeEnd('[Stats] Stats calculation');

      // キャッシュの更新処理を修正
      cacheManager.updateStatsCache(viewId, identifier, updatedStats);
      this.#currentStats.set(viewId, updatedStats);
      
      // UIを更新
      await this.displayStats(updatedStats, viewId);

      // イベントにメタデータを追加
      event.isStatsCalculated = true;
      event.amountMsats = amountMsats;

    } catch (error) {
      console.error('[Stats] Error handling zap event:', error, {
        eventId: event?.id,
        viewId,
        identifier
      });
    } finally {
      console.timeEnd(`[Stats] Process zap event ${event.id}`);
    }
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

  async displayStats(stats, viewId) {
    console.group(`[Stats] Display update for ${viewId}`);
    console.time('Total display time');
    try {
      console.time('DisplayZapStats call');
      await displayZapStats(stats, viewId);
      console.timeEnd('DisplayZapStats call');
    } catch (error) {
      console.error('[Stats] Display error:', error);
    } finally {
      console.timeEnd('Total display time');
      console.groupEnd();
    }
  }
}

export const statsManager = new StatsManager();
