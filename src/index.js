import { 
  APP_CONFIG, 
  ZAP_CONFIG, 
  ZAP_AMOUNT_CONFIG, // 追加: カラーモード設定をインポート
  ViewerConfig 
} from "./AppSettings.js";
import {
  createDialog,
  initializeZapPlaceholders,
  initializeZapStats,
  showDialog,
  renderZapListFromCache, // renderZapListFromCacheを追加
} from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profilePool } from "./ProfilePool.js";
import { eventPool } from "./EventPool.js"; // パスを更新
import { cacheManager } from "./CacheManager.js";
import { ZapInfo } from "./ZapInfo.js";  // ZapInfoクラスをインポート

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const config = ViewerConfig.fromButton(button);
    subscriptionManager.setViewConfig(viewId, config);

    // 1. ダイアログとスケルトンUIの表示
    createDialog(viewId);
    showDialog(viewId);
    
    // キャッシュされたZapのカラーモード更新
    const cachedEvents = cacheManager.getZapEvents(viewId);
    await updateCachedZapsColorMode(cachedEvents, config);

    // カラーモード設定のデバッグ情報
    console.debug('Color mode:', {
      fromAttribute: button.getAttribute("data-zap-color-mode"),
      configured: config.isColorModeEnabled,
      default: ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE
    });

    initializeZapPlaceholders(APP_CONFIG.INITIAL_LOAD_COUNT, viewId);
    initializeZapStats(viewId);

    // キャッシュされたデータがある場合、プロフィール取得を先に開始
    if (cachedEvents.length > 0) {
      const pubkeys = [...new Set(cachedEvents.map(event => event.pubkey))];
      profilePool.fetchProfiles(pubkeys);
    }

    // 2. キャッシュされたデータの表示（あれば）
    const { hasEnoughCachedEvents } = await cacheManager.processCachedData(
      viewId,
      config,
      renderZapListFromCache
    );

    if (hasEnoughCachedEvents) {
      subscriptionManager.setupInfiniteScroll(viewId);
    }

    // 3. 非同期でデータ取得を開始
    if (!button.hasAttribute("data-initialized")) {
      const initTasks = [
        // リレー接続
        eventPool.connectToRelays(config.relayUrls),
        // Zapイベントの購読開始
        subscriptionManager.initializeSubscriptions(config, viewId),
        // プロフィールプールの初期化
        !profilePool.isInitialized ? profilePool.initialize() : Promise.resolve(),
        // 統計情報の取得
        statsManager.initializeStats(config.identifier, viewId),
      ];

      Promise.all(initTasks)
        .then(() => {
          button.setAttribute("data-initialized", "true");
        })
        .catch((error) => {
          console.error("Failed to initialize:", error);
        });
    }
  } catch (error) {
    console.error(`Failed to handle click for viewId ${viewId}:`, error);
  }
}

// カラーモード更新用のヘルパー関数
async function updateCachedZapsColorMode(events, config) {
  try {
    events.forEach(event => {
      const zapInfo = cacheManager.getZapInfo(event.id);
      if (zapInfo?.satsAmount != null) {
        zapInfo.colorClass = ZapInfo.getAmountColorClass(
          zapInfo.satsAmount,
          config.isColorModeEnabled
        );
        cacheManager.setZapInfo(event.id, zapInfo);
      }
    });
  } catch (error) {
    console.error('Failed to update color mode:', error);
  }
}

function initializeApp() {
  // Set global libraries
  Object.entries(APP_CONFIG.LIBRARIES).forEach(([key, value]) => {
    window[key] = value;
  });

  // ボタンの初期化
  document.querySelectorAll("button[data-nzv-id]").forEach((button, index) => {
    if (!button.hasAttribute("data-zap-view-id")) {
      const viewId = `nostr-zap-view-${index}`;
      button.setAttribute("data-zap-view-id", viewId);
      button.addEventListener("click", () => {
        handleButtonClick(button, viewId);
      });
    }
  });
}

// Run the application
document.addEventListener("DOMContentLoaded", initializeApp);

// Public API - zapPoolをeventPoolに変更
export { ZAP_CONFIG as CONFIG, profilePool, eventPool, APP_CONFIG };
