import { APP_CONFIG, ZAP_CONFIG } from "./ZapConfig.js";
import { ZapConfig } from "./ZapConfig.js";
import { 
  createDialog, 
  showNoZapsMessage, 
  initializeZapPlaceholders,
  initializeZapStats,
  showDialog,
  renderZapListFromCache // renderZapListFromCacheを追加
} from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profileManager } from "./ProfileManager.js";
import { poolManager } from "./ZapPool.js";

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素 
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const config = ZapConfig.fromButton(button);

    // 既存のダイアログを削除
    const existingDialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (existingDialog) {
      existingDialog.remove();
    }

    // 1. ダイアログとスケルトンを表示
    subscriptionManager.setViewConfig(viewId, config);
    createDialog(viewId);

    // キャッシュの確認とUI初期化の順序を修正
    const viewState = subscriptionManager.getOrCreateViewState(viewId);
    const cachedStats = await statsManager.handleCachedStats(viewId, config.identifier);
    
    showDialog(viewId);

    if (viewState.zapEventsCache.length > 0) {
      await renderZapListFromCache(viewState.zapEventsCache, viewId);
      if (!cachedStats) {
        initializeZapStats(viewId);
      }
    } else if (!viewState.isInitialFetchComplete) {
      initializeZapPlaceholders(config.maxCount, viewId);
      if (!cachedStats) {
        initializeZapStats(viewId);
      }
    } else {
      showNoZapsMessage(viewId);
    }

    // 3. バックグラウンドでデータ取得を実行
    if (!button.hasAttribute('data-initialized')) {
      await Promise.all([
        poolManager.connectToRelays(config.relayUrls),
        statsManager.initializeStats(config.identifier, viewId),
        subscriptionManager.initializeSubscriptions(config, viewId)
      ]);

      subscriptionManager.setupInfiniteScroll(viewId);
      button.setAttribute('data-initialized', 'true');
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
