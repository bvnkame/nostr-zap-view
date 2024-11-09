import { decode as decodeBolt11 } from "light-bolt11-decoder";
import * as NostrTools from "nostr-tools";
import { CONFIG } from "./ZapManager.js";
import { fetchLatestZaps } from "./ZapManager.js";
import { createDialog } from "./UIManager.js";
import { profileManager } from "./ProfileManager.js";
import { zapPool } from "./ZapPool.js";

// グローバル設定の定義
const APP_CONFIG = {
  LIBRARIES: {
    decodeBolt11,
    NostrTools,
  },
  DEFAULT_OPTIONS: {
    theme: "light",
    maxCount: 5,
  },
};

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
export { CONFIG, profileManager, zapPool };
