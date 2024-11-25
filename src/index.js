import { APP_CONFIG } from "./ZapConfig.js";
import { ZAP_CONFIG } from "./ZapConfig.js";
import { fetchLatestZaps } from "./ZapManager.js";
import { createDialog } from "./UIManager.js";
import { profileManager } from "./ProfileManager.js";
import { zapPool } from "./ZapPool.js";

// Initialize the application
function initializeApp() {
  // Set global libraries
  Object.entries(APP_CONFIG.LIBRARIES).forEach(([key, value]) => {
    window[key] = value;
  });

  // Initial UI setup
  createDialog();

  // Set event listeners
  const fetchButton = document.querySelector("button[data-nzv-identifier]");
  if (fetchButton) {
    fetchButton.addEventListener("click", fetchLatestZaps);
  }

  // 各ZapボタンにユニークなビューIDを割り当て
  document.querySelectorAll("button[data-nzv-identifier]").forEach((button, index) => {
    const viewId = `nostr-zap-view-${index}`;  // オプション: より一貫性のある名前に変更
    button.setAttribute("data-zap-view-id", viewId);
    createDialog(viewId);
    button.addEventListener("click", fetchLatestZaps);
  });
}

// Run the application
document.addEventListener("DOMContentLoaded", initializeApp);

// Public API
export { ZAP_CONFIG as CONFIG, profileManager, zapPool, APP_CONFIG };
