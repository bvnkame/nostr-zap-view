import { poolManager } from "./ZapPool.js";
import { initializeZapPlaceholders, replacePlaceholderWithZap, prependZap, showDialog, displayZapStats, renderZapListFromCache, initializeZapStats, showNoZapsMessage } from "./UIManager.js";
import { decodeIdentifier, isEventIdentifier } from "./utils.js"; // isEventIdentifierを追加
import { ZapConfig, ZAP_CONFIG as CONFIG } from "./ZapConfig.js";
import { statsManager } from "./StatsManager.js";

class ZapSubscriptionManager {
  // ビューの状態とconfig情報を管理するクラス

  constructor() {
    this.viewStates = new Map(); // 各ビューの状態を管理
    this.configStore = new Map(); // 設定を保存するためのMap
  }

  /**
   * 指定されたviewIdの状態を取得。存在しない場合は新規作成
   * @param {string} viewId - ビューの一意識別子
   * @returns {Object} ビューの状態オブジェクト
   */
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

  /**
   * 特定のビューの設定を保存
   * @param {string} viewId - ビューの一意識別子
   * @param {Object} config - 保存する設定オブジェクト
   */
  setViewConfig(viewId, config) {
    this.configStore.set(viewId, config);
  }

  /**
   * 特定のビューの設定を取得
   * @param {string} viewId - ビューの一意識別子
   * @returns {Object} 保存された設定オブジェクト
   */
  getViewConfig(viewId) {
    return this.configStore.get(viewId);
  }

  /**
   * ビューのキャッシュをクリア
   * @param {string} viewId - クリアするビューのID
   */
  clearCache(viewId) {
    const state = this.getOrCreateViewState(viewId);
    state.zapEventsCache = [];
    state.currentStats = null;  // Fix: currentStats����クリア
  }

  /**
   * Zapイベントの処理を行う
   * - キャッシュに存在しない場合のみ処理
   * - リファレンス情報の更新
   * - UIの更新
   * @param {Object} event - Zapイベント
   * @param {number} maxCount - 表示最大数
   * @param {string} viewId - ビューID
   */
  async handleZapEvent(event, maxCount, viewId) {
    const state = this.getOrCreateViewState(viewId);
    if (!state.zapEventsCache.some((e) => e.id === event.id)) {
      // イベントの作成時刻をチェックしてリアルタイムかどうかを判定
      const isRealTime = event.created_at >= Math.floor(Date.now() / 1000) - 5;
      event.isRealTimeEvent = isRealTime;
      
      this.updateEventReference(event, viewId);

      if (isRealTime) {
        state.zapEventsCache.unshift(event);
        await prependZap(event, viewId);
        await this.updateEventStats(event, state, viewId);
      } else {
        state.zapEventsCache.push(event);
        state.zapEventsCache.sort((a, b) => b.created_at - a.created_at);
        
        const index = state.zapEventsCache.findIndex((e) => e.id === event.id);
        if (index < maxCount) {
          await replacePlaceholderWithZap(event, index, viewId);
          await new Promise(resolve => setTimeout(resolve, 50));
          await renderZapListFromCache(state.zapEventsCache, maxCount, viewId);
        }
      }

    }
  }

  /**
   * イベントの統計情報を更新
   * - BOLT11からの金額デコード
   * - 統計情報の計算と表示更新
   * @param {Object} event - Zapイベント
   * @param {Object} state - ビューの状態
   * @param {string} viewId - ビューID
   */
  async updateEventStats(event, state, viewId) {
    const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
    if (bolt11Tag) {
      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsats = parseInt(decoded.sections.find(section => section.name === "amount")?.value ?? "0", 10);

      if (amountMsats > 0) {
        state.currentStats = state.currentStats || { count: 0, msats: 0, maxMsats: 0 };
        const updatedStats = await statsManager.incrementStats(state.currentStats, amountMsats, viewId);
        state.currentStats = updatedStats;
        displayZapStats(updatedStats, viewId);
        event.isStatsCalculated = true;
        event.amountMsats = amountMsats;
      }
    }
  }

  /**
   * イベントの参照情報を更新
   * - note1/nevent1の場合はスキップ
   * - リレーから参照情報をフェッチ
   * @param {Object} event - Zapイベント
   * @param {string} viewId - ビューID
   * @returns {boolean} 更新成功の有無
   */
  async updateEventReference(event, viewId) {
    const eTag = event.tags.find(tag => tag[0] === 'e');
    const config = this.getViewConfig(viewId);
    
    // Identifierがnote1またはnevent1の場合は参照情報を取得しない
    const identifier = config?.identifier || '';
    if (isEventIdentifier(identifier)) {
      return false;
    }

    if (eTag && config?.relayUrls) {
      try {
        const reference = await poolManager.fetchReference(config.relayUrls, eTag[1]);
        if (reference) {
          event.reference = reference;
          return true;
        }
      } catch (error) {
        console.error("Failed to fetch reference:", error);
      }
    }
    return false;
  }

  /**
   * サブスクリプションの初期化
   * - 識別子のデコード
   * - 統計情報の初期取得
   * - Zapイベントの購読開始
   * @param {Object} config - 設定オブジェクト
   * @param {string} viewId - ビューID
   */
  async initializeSubscriptions(config, viewId) {
    const decoded = decodeIdentifier(config.identifier, config.maxCount);
    if (!decoded) throw new Error(CONFIG.ERRORS.DECODE_FAILED);

    this.setViewConfig(viewId, config);
    const state = this.getOrCreateViewState(viewId);
    state.isInitialFetchComplete = false;

    // 統計情報の取得を非同期で開始
    statsManager.getZapStats(config.identifier, viewId)
      .then(stats => {
        state.currentStats = stats;
        if (!stats?.error) {
          displayZapStats(stats, viewId);
        }
      });

    return new Promise((resolve) => {
      poolManager.subscribeToZaps(viewId, config, decoded, {
        onevent: async (event) => {
          await this.handleZapEvent(event, config.maxCount, viewId);
        },
        oneose: () => {
          state.isInitialFetchComplete = true;
          resolve();
        }
      });
    });
  }

  /**
   * キャッシュされたZapの処理
   * - 統計情報の再計算
   * - UIの更新
   * @param {string} viewId - ビューID
   * @param {Object} config - 設定オブジェクト
   */
  async handleCachedZaps(viewId, config) {
    const viewState = this.getOrCreateViewState(viewId);
    try {
      const stats = await statsManager.getZapStats(config.identifier, viewId);
      const updatedStats = !stats?.error 
        ? statsManager.recalculateStats(stats, viewState.zapEventsCache)
        : { timeout: stats.timeout };
      
      displayZapStats(updatedStats, viewId);
      await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
    } catch (error) {
      console.error("Failed to handle cached zaps:", error);
      displayZapStats({ timeout: true }, viewId);
    }
  }
}

const subscriptionManager = new ZapSubscriptionManager();

/**
 * 最新のZapを取得する
 * - ダイアログの表示
 * - キャッシュの有無による処理分岐
 * - エラー処理
 * @param {Event} event - クリックイベント
 */
export async function fetchLatestZaps(event) {
  const button = event.currentTarget;
  const viewId = button.getAttribute("data-zap-view-id");
  
  try {
    if (!viewId) throw new Error("Missing view ID");
    const zapDialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (!zapDialog) throw new Error(CONFIG.ERRORS.DIALOG_NOT_FOUND);

    const config = ZapConfig.fromButton(button);
    subscriptionManager.setViewConfig(viewId, config);
    const viewState = subscriptionManager.getOrCreateViewState(viewId);
    const hasCache = viewState.zapEventsCache.length > 0;

    showDialog(viewId);

    if (hasCache) {
      await renderZapListFromCache(viewState.zapEventsCache, config.maxCount, viewId);
      if (viewState.currentStats) {
        displayZapStats(viewState.currentStats, viewId);
      }
    } else {
      subscriptionManager.clearCache(viewId);
      await initializeNewFetch(viewId, config);
    }

    if (viewState.zapEventsCache.length === 0 && viewState.isInitialFetchComplete) {
      showNoZapsMessage(viewId);
    }
  } catch (error) {
    console.error("Error occurred while fetching Zaps:", error);
    displayZapStats({ timeout: true }, viewId);
  }
}

/**
 * 新規フェッチの初期化
 * - プレースホルダーの初期化
 * - 統計情報の初期化
 * - サブスクリプションの開始
 * @param {string} viewId - ビューID
 * @param {Object} config - 設定オブジェクト
 */
async function initializeNewFetch(viewId, config) {
  initializeZapPlaceholders(config.maxCount, viewId);
  initializeZapStats(viewId);  // スケルトン表示を即時実行

  await subscriptionManager.initializeSubscriptions(config, viewId);
}
