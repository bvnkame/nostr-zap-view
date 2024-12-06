import { API_CONFIG } from "./AppSettings.js";
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
    const cached = await this.#checkCachedStats(viewId, identifier);
    if (cached) {
      return cached;
    }

    const stats = await this.fetchStats(identifier);
    if (stats) {
      cacheManager.updateStatsCache(viewId, identifier, stats);
    }
    return stats;
  }

  async fetchStats(identifier) {
    try {
      const response = await this._fetchFromApi(identifier);
      const stats = this._formatStats(response);
      console.log("Fetched Zap stats:", stats);
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

  async initializeStats(identifier, viewId, showSkeleton = false) {
    // 既に初期化中または完了している場合は進行中のPromiseを返す
    if (this.#initializationStatus.has(viewId)) {
      return this.#initializationStatus.get(viewId);
    }

    const initPromise = (async () => {
      try {
        const stats = await this.getZapStats(identifier, viewId);
        if (stats) {
          this.displayStats(stats, viewId);
          this.#currentStats.set(viewId, stats);
        }
        return stats;
      } catch (error) {
        console.error("Stats initialization failed:", error);
        return null;
      } finally {
        // 初期化完了後にステータスをクリア
        this.#initializationStatus.delete(viewId);
      }
    })();

    // 進行中の初期化を追跡
    this.#initializationStatus.set(viewId, initPromise);
    return initPromise;
  }

  async #checkCachedStats(viewId, identifier) {
    const cached = cacheManager.getCachedStats(viewId, identifier);
    const now = Date.now();

    if (cached && now - cached.timestamp < API_CONFIG.CACHE_DURATION) {
      return cached.stats;
    }

    return null;
  }

  getCurrentStats(viewId) {
    return this.#currentStats.get(viewId);
  }

  async handleZapEvent(event, viewId, identifier) {
    // リアルタイムイベントでない場合は早期リターン
    if (!event?.isRealTimeEvent) {
      return;
    }

    try {
      const amountMsats = this.extractAmountFromBolt11(
        event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1]
      );

      if (amountMsats <= 0) return;

      // キャッシュされた統計情報を取得
      const currentStats = cacheManager.getViewStats(viewId);
      
      // 現在の統計情報がない場合は初期値を使用
      const baseStats = {
        count: currentStats?.count || 0,
        msats: currentStats?.msats || 0,
        maxMsats: currentStats?.maxMsats || 0
      };

      // 新しい統計情報を計算
      const updatedStats = {
        count: baseStats.count + 1,
        msats: baseStats.msats + amountMsats,
        maxMsats: Math.max(baseStats.maxMsats, amountMsats)
      };

      // キャッシュを更新
      if (identifier) {
        cacheManager.updateStatsCache(viewId, identifier, updatedStats);
      }
      
      // UIを更新
      this.displayStats(updatedStats, viewId);

      // イベントにメタデータを追加
      event.isStatsCalculated = true;
      event.amountMsats = amountMsats;

    } catch (error) {
      console.error("Failed to handle zap event stats:", error);
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

  displayStats(stats, viewId) {
    displayZapStats(stats, viewId);
  }
}

export const statsManager = new StatsManager();
