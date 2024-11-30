import { APP_CONFIG, ZAP_CONFIG } from "./ZapConfig.js";
import { ZapConfig } from "./ZapConfig.js";
import { createDialog, initializeZapPlaceholders, initializeZapStats } from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profileManager } from "./ProfileManager.js";
import { zapPool } from "./ZapPool.js";

/**
 * ボタンクリック時の初期化とデータ取得を行う
 * @param {HTMLElement} button - 初期化対象のボタン要素 
 * @param {string} viewId - ビューの識別子
 */
async function handleButtonClick(button, viewId) {
  try {
    const config = ZapConfig.fromButton(button);

    // 1. 即時実行: UIの表示を最優先
    createDialog(viewId);
    initializeZapPlaceholders(config.maxCount, viewId);
    initializeZapStats(viewId);
    subscriptionManager.handleViewClick(viewId);

    // 2. 未初期化の場合のみバックグラウンドで実行
    if (!button.hasAttribute('data-initialized')) {
      // 統計情報の初期化とZapイベントの購読を並行して開始
      Promise.all([
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
