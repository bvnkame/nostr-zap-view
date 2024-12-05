import { decode as decodeBolt11 } from "light-bolt11-decoder";
import * as NostrTools from "nostr-tools";

// Aggregate application settings
export const APP_CONFIG = {
  LIBRARIES: {
    decodeBolt11,
    NostrTools,
  },
  DEFAULT_OPTIONS: {
    theme: "light",
    colorMode: true,
  },
  INITIAL_LOAD_COUNT: 15, // 追加：初期ロード件数のデフォルト値
  ADDITIONAL_LOAD_COUNT: 20, // 一度に読み込む件数を減らす
  LOAD_TIMEOUT: 10000, // タイムアウト時間を延長
  INFINITE_SCROLL: {
    ROOT_MARGIN: '500px', // スクロール検知の余裕を調整
    THRESHOLD: 0.1,
    DEBOUNCE_TIME: 500 // デバウンス時間を増やす
  }
};

// Zap-related settings
export const ZAP_CONFIG = {
  DEFAULT_LIMIT: 1,
  ERRORS: {
    DIALOG_NOT_FOUND: "Zap dialog not found",
    BUTTON_NOT_FOUND: "Fetch button not found",
    DECODE_FAILED: "Failed to decode identifier",
  },
};

// Add new settings for zap amount thresholds
export const ZAP_AMOUNT_CONFIG = {
  DEFAULT_COLOR_MODE: true,
  THRESHOLDS: [
    { value: 10000, className: "zap-amount-10k" },
    { value: 5000, className: "zap-amount-5k" },
    { value: 2000, className: "zap-amount-2k" },
    { value: 1000, className: "zap-amount-1k" },
    { value: 500, className: "zap-amount-500" },
    { value: 200, className: "zap-amount-200" },
    { value: 100, className: "zap-amount-100" },
  ],
  DEFAULT_CLASS: "zap-amount-default",
  DISABLED_CLASS: ""
};

// Add new settings for zap dialog
export const DIALOG_CONFIG = {
  DEFAULT_TITLE: "Zap List",
  NO_ZAPS_MESSAGE: "まだZapがありません",
  // 他の必要な設定...
};

// Timeout settings for metadata requests
export const REQUEST_CONFIG = {
  METADATA_TIMEOUT: 20000,  // プロフィール、reference、nip05検証用のタイムアウト
};

// API-related settings
export const API_CONFIG = {
  REQUEST_TIMEOUT: 4000,
  CACHE_DURATION: 300000,
};

// Profile management settings
export const PROFILE_CONFIG = {
  BATCH_SIZE: 20,
  BATCH_DELAY: 50,
  RELAYS: [
    "wss://relay.nostr.band",
    "wss://purplepag.es",
    "wss://relay.damus.io",
    "wss://nostr.wine",
    "wss://directory.yabu.me",
  ],
};

// Add new settings for batch processing
export const BATCH_CONFIG = {
  REFERENCE_PROCESSOR: {
    BATCH_SIZE: 20,
    BATCH_DELAY: 50,
  },
  SUPPORTED_EVENT_KINDS: [1, 30023, 30030, 30009, 40, 42, 31990],
};

export class ViewerConfig {
  constructor(identifier, relayUrls, colorMode = null) {
    this.identifier = identifier;
    this.relayUrls = relayUrls;
    // boolean型に確実に変換
    this.isColorModeEnabled = colorMode === null ? 
      ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE : 
      String(colorMode).toLowerCase() === "true";
  }

  static determineColorMode(button) {
    if (!button) return ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE;
    const colorModeAttr = button.getAttribute("data-zap-color-mode");
    // boolean型に確実に変換
    return colorModeAttr === null ? 
      ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE : 
      String(colorModeAttr).toLowerCase() === "true";
  }

  static fromButton(button) {
    if (!button) throw new Error(ZAP_CONFIG.ERRORS.BUTTON_NOT_FOUND);
    const colorMode = ViewerConfig.determineColorMode(button);
    console.log(`fromButton - data-zap-color-mode: ${colorMode}`);
    return new ViewerConfig(
      button.getAttribute("data-nzv-id"),
      button.getAttribute("data-relay-urls").split(","),
      colorMode
    );
  }
}