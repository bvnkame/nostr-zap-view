import { APP_CONFIG, ZAP_CONFIG } from "./AppSettings.js";
import { ViewerConfig } from "./AppSettings.js";
import { 
  createDialog, 
  initializeZapPlaceholders,
  initializeZapStats,
  showDialog,
  renderZapListFromCache // renderZapListFromCacheを追加
} from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profileManager } from "./ProfileManager.js";
import { poolManager } from "./PoolManager.js";  // パスを更新
import { cacheManager } from "./CacheManager.js";

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素 
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const config = ViewerConfig.fromButton(button);
    subscriptionManager.setViewConfig(viewId, config);

    // 1. ��イアログとスケルトンUIの表示
    createDialog(viewId);
    showDialog(viewId);
    initializeZapPlaceholders(APP_CONFIG.INITIAL_LOAD_COUNT, viewId);
    initializeZapStats(viewId);

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
    if (!button.hasAttribute('data-initialized')) {
      const initTasks = [
        // リレー接続
        poolManager.connectToRelays(config.relayUrls),
        // 統計情報の取得
        statsManager.initializeStats(config.identifier, viewId),
        // Zapイベントの購読開始
        subscriptionManager.initializeSubscriptions(config, viewId)
      ];

      Promise.all(initTasks)
        .then(() => {
          button.setAttribute('data-initialized', 'true');
        })
        .catch(error => {
          console.error('Failed to initialize:', error);
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

  // ボタンの初期化を一本化
  document.querySelectorAll("button[data-nzv-id]").forEach((button, index) => {
    if (!button.hasAttribute("data-zap-view-id")) {
      const viewId = `nostr-zap-view-${index}`;
      button.setAttribute("data-zap-view-id", viewId);
      button.addEventListener("click", () => handleButtonClick(button, viewId));
    }
  });
}

// Run the application
document.addEventListener("DOMContentLoaded", initializeApp);

// Public API - zapPoolをpoolManagerに変更
export { ZAP_CONFIG as CONFIG, profileManager, poolManager, APP_CONFIG };
