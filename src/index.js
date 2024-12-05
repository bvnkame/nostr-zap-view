import { APP_CONFIG, ZAP_CONFIG } from "./AppSettings.js";
import { ViewerConfig } from "./AppSettings.js";
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
    const colorMode = button.getAttribute("data-zap-color-mode");
    console.debug('Color mode setting:', colorMode, 'Parsed:', config.isColorModeEnabled);
    
    subscriptionManager.setViewConfig(viewId, config);

    // 1. ダイアログとスケルトンUIの表示
    createDialog(viewId);
    showDialog(viewId);
    
    // カラーモードの設定をキャッシュされたZapInfoに適用（ZapInfo.jsのメソッドを直接使用）
    const isColorMode = config.isColorModeEnabled;
    const cachedEvents = cacheManager.getZapEvents(viewId);
    cachedEvents.forEach(event => {
      const zapInfo = cacheManager.getZapInfo(event.id);
      if (zapInfo && typeof zapInfo.satsAmount === 'number') {
        const newColorClass = ZapInfo.getAmountColorClass(zapInfo.satsAmount, isColorMode);
        console.debug('Updating color class:', {eventId: event.id, isColorMode, newColorClass});
        zapInfo.colorClass = newColorClass;
        cacheManager.setZapInfo(event.id, zapInfo);
      }
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
