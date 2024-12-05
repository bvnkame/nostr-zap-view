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
    const config = ViewerConfig.fromButton(button);
    if (!config) {
      throw new Error('Failed to create config from button');
    }

    // configを設定してからダイアログを作成
    subscriptionManager.setViewConfig(viewId, config);
    const dialog = await createDialog(viewId, config);
    
    if (!dialog) {
      throw new Error(ZAP_CONFIG.ERRORS.DIALOG_NOT_FOUND);
    }

    // 基本初期化完了後にダイアログを表示
    await showDialog(viewId);

    // 残りの処理を非同期で実���
    setTimeout(async () => {
      // カラーモードの設定
      const colorMode = ViewerConfig.determineColorMode(button);
      
      // キャッシュ処理
      const cachedEvents = cacheManager.getZapEvents(viewId);
      if (cachedEvents.length > 0) {
        await updateCachedZapsColorMode(cachedEvents, config);
        const pubkeys = [...new Set(cachedEvents.map(event => event.pubkey))];
        profilePool.fetchProfiles(pubkeys);
      }

      // キャッシュデータの表示と追加データの取得
      const { hasEnoughCachedEvents } = await cacheManager.processCachedData(
        viewId,
        config,
        renderZapListFromCache
      );

      if (hasEnoughCachedEvents) {
        subscriptionManager.setupInfiniteScroll(viewId);
      }

      // バックグラウンドでの初期化
      if (!button.hasAttribute("data-initialized")) {
        const identifier = button.getAttribute("data-nzv-id");
        Promise.all([
          eventPool.connectToRelays(config.relayUrls),
          subscriptionManager.initializeSubscriptions(config, viewId),
          !profilePool.isInitialized ? profilePool.initialize() : Promise.resolve(),
          statsManager.initializeStats(identifier, viewId, true)
        ]).then(() => {
          button.setAttribute("data-initialized", "true");
        });
      }
    }, 0);
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
