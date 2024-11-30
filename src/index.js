import { APP_CONFIG, ZAP_CONFIG } from "./ZapConfig.js";
import { ZapConfig } from "./ZapConfig.js";
import { createDialog } from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profileManager } from "./ProfileManager.js";
import { zapPool, poolManager } from "./ZapPool.js";  // poolManagerを追加

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素 
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const config = ZapConfig.fromButton(button);

    // 1. 即座にダイアログとスケルトンを表示
    subscriptionManager.setViewConfig(viewId, config);
    createDialog(viewId);
    subscriptionManager.handleViewClick(viewId);

    // 2. バックグラウンドでリレー接続とデータ取得を実行
    if (!button.hasAttribute('data-initialized')) {
      Promise.all([
        poolManager.connectToRelays(config.relayUrls),
        statsManager.initializeStats(config.identifier, viewId),
        subscriptionManager.initializeSubscriptions(config, viewId)
      ]).catch(error => {
        console.error("Failed to initialize:", error);
      });

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

  // 単一ボタンの初期化
  const fetchButton = document.querySelector("button[data-nzv-id]");
  if (fetchButton) {
    const viewId = "nostr-zap-view-0";
    fetchButton.setAttribute("data-zap-view-id", viewId);
    fetchButton.addEventListener("click", () => handleButtonClick(fetchButton, viewId));
  }

  // 複数ボタンの初期化
  document.querySelectorAll("button[data-nzv-id]").forEach((button, index) => {
    const viewId = `nostr-zap-view-${index}`;
    button.setAttribute("data-zap-view-id", viewId);
    button.addEventListener("click", () => handleButtonClick(button, viewId));
  });
}

// Run the application
document.addEventListener("DOMContentLoaded", initializeApp);

// Public API
export { ZAP_CONFIG as CONFIG, profileManager, zapPool, APP_CONFIG };
