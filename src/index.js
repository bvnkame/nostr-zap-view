import { APP_CONFIG } from "./ZapConfig.js";
import { ZAP_CONFIG } from "./ZapConfig.js";
import { fetchLatestZaps } from "./ZapManager.js";
import { createDialog } from "./UIManager.js";
import { profileManager } from "./ProfileManager.js";
import { zapPool } from "./ZapPool.js";

// アプリケーションの初期化
function initializeApp() {
  // グローバルライブラリの設定
  Object.entries(APP_CONFIG.LIBRARIES).forEach(([key, value]) => {
    window[key] = value;
  });

  // UIの初期設定
  createDialog();

  // イベントリスナーの設定
  const fetchButton = document.querySelector("button[data-identifier]");
  if (fetchButton) {
    fetchButton.addEventListener("click", fetchLatestZaps);
  }
}

// アプリケーションの実行
document.addEventListener("DOMContentLoaded", initializeApp);

// 公開API
export { ZAP_CONFIG as CONFIG, profileManager, zapPool, APP_CONFIG };
