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
  const fetchButton = document.querySelector("button[data-identifier]");
  if (fetchButton) {
    fetchButton.addEventListener("click", fetchLatestZaps);
  }

  // 各ZapボタンにユニークなビューIDを割り当て
  document.querySelectorAll("button[data-identifier]").forEach((button, index) => {
    const viewId = `zap-view-${index}`;
    button.setAttribute("data-zap-view-id", viewId);
    createDialog(viewId);
    button.addEventListener("click", fetchLatestZaps);
  });
}

// Run the application
document.addEventListener("DOMContentLoaded", initializeApp);

// Public API
export { ZAP_CONFIG as CONFIG, profileManager, zapPool, APP_CONFIG };
