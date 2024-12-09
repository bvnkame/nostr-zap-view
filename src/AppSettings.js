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
  INITIAL_LOAD_COUNT: 10, // 追加：初期ロード件数のデフォルト値
  ADDITIONAL_LOAD_COUNT: 30, // 一度に読み込む件数を減らす
  LOAD_TIMEOUT: 10000, // タイムアウト時間を延長
  BUFFER_INTERVAL: 500, // バッファ間隔（ms）
  INFINITE_SCROLL: {
    ROOT_MARGIN: '700px', // スクロール検知の余裕を調整
    THRESHOLD: 0.1,
    DEBOUNCE_TIME: 500, // デバウンス時間を増やす
    RETRY_DELAY: 1000 // リトライ遅延時間（ms）
  },
  ZAP_CONFIG: {
    DEFAULT_LIMIT: 1,
    ERRORS: {
      DIALOG_NOT_FOUND: "Zap dialog not found",
      BUTTON_NOT_FOUND: "Fetch button not found",
      DECODE_FAILED: "Failed to decode identifier",
    },
  },
  ZAP_AMOUNT_CONFIG: {
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
    DISABLED_CLASS: "",
  },
  DIALOG_CONFIG: {
    DEFAULT_TITLE: "To ",
    NO_ZAPS_MESSAGE: "No Zaps yet!<br>Send the first Zap!",
    DEFAULT_NO_ZAPS_DELAY: 1500,
  },
  REQUEST_CONFIG: {
    METADATA_TIMEOUT: 20000,
    REQUEST_TIMEOUT: 4000,
    CACHE_DURATION: 300000,
  },
  PROFILE_CONFIG: {
    BATCH_SIZE: 20,
    BATCH_DELAY: 50,
    RELAYS: [
      "wss://relay.nostr.band",
      "wss://purplepag.es",
      "wss://relay.damus.io",
      "wss://nostr.wine",
      "wss://directory.yabu.me",
    ],
  },
  BATCH_CONFIG: {
    REFERENCE_PROCESSOR: {
      BATCH_SIZE: 20,
      BATCH_DELAY: 50,
    },
    SUPPORTED_EVENT_KINDS: [1, 30023, 30030, 30009, 40, 42, 31990],
  },
};

export class ViewerConfig {
  constructor(identifier, relayUrls, colorMode = null) {
    this.identifier = identifier;
    this.relayUrls = relayUrls;
    // boolean型に確実に変換
    this.isColorModeEnabled = colorMode === null ? 
      APP_CONFIG.ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE : 
      String(colorMode).toLowerCase() === "true";
  }

  static determineColorMode(button) {
    if (!button) return APP_CONFIG.ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE;
    const colorModeAttr = button.getAttribute("data-zap-color-mode");
    // boolean型に確実に変換
    return colorModeAttr === null ? 
      APP_CONFIG.ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE : 
      String(colorModeAttr).toLowerCase() === "true";
  }

  static fromButton(button) {
    if (!button) throw new Error(APP_CONFIG.ZAP_CONFIG.ERRORS.BUTTON_NOT_FOUND);
    const colorMode = ViewerConfig.determineColorMode(button);
    return new ViewerConfig(
      button.getAttribute("data-nzv-id"),
      button.getAttribute("data-relay-urls").split(","),
      colorMode
    );
  }
}