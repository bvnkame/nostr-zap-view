import { 
  APP_CONFIG, 
  ZAP_CONFIG, 
  ViewerConfig 
} from "./AppSettings.js";
import {
  createDialog,
  showDialog,
  renderZapListFromCache,
} from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profilePool } from "./ProfilePool.js";
import { eventPool } from "./EventPool.js";
import { cacheManager } from "./CacheManager.js";
import { ZapInfo } from "./ZapInfo.js";

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const colorMode = ViewerConfig.determineColorMode(button);
    console.log(`Initial color mode for ${viewId}:`, colorMode);
    
    const config = ViewerConfig.fromButton(button);
    console.log(`Config created for ${viewId}:`, config);
    
    subscriptionManager.setViewConfig(viewId, config);

    // ダイアログの作成と初期化を待機
    const dialog = await createDialog(viewId);
    if (!dialog) throw new Error(ZAP_CONFIG.ERRORS.DIALOG_NOT_FOUND);

    // ダイアログが完全に初期化されるまで待機
    await new Promise(resolve => {
      if (dialog.getOperations()) {
        resolve();
      } else {
        dialog.addEventListener('dialog-initialized', resolve, { once: true });
      }
    });
    
    await showDialog(viewId);
    
    // キャッシュされたZapのカラーモード更新
    const cachedEvents = cacheManager.getZapEvents(viewId);
    if (cachedEvents.length > 0) {
      await updateCachedZapsColorMode(cachedEvents, config);
    }

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
      const identifier = button.getAttribute("data-nzv-id");
      const initTasks = [
        // リレー接続
        eventPool.connectToRelays(config.relayUrls),
        // Zapイベントの購読開始
        subscriptionManager.initializeSubscriptions(config, viewId),
        // プロフィールプールの初期化
        !profilePool.isInitialized ? profilePool.initialize() : Promise.resolve(),
        // 統計情報の取得
        statsManager.initializeStats(identifier, viewId, true) // スケルトン表示を有効化
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

      // カラーモード設定の初期化
      if (!button.hasAttribute("data-zap-color-mode")) {
        button.setAttribute("data-zap-color-mode", ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE.toString());
      }

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
