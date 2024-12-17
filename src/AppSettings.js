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
  BATCH_SIZE: 5,
  REQ_CONFIG: {
    INITIAL_LOAD_COUNT: 15,
    ADDITIONAL_LOAD_COUNT: 20,
  },
  LOAD_TIMEOUT: 10000, // タイムアウト時間（ms）
  BUFFER_INTERVAL: 500, // バッファ間隔（ms）
  BUFFER_MIN_INTERVAL: 100, // バッファ最小間隔（ms）
  INFINITE_SCROLL: {
    ROOT_MARGIN: '400px', // スクロール検知のマージン
    THRESHOLD: 0.1, // スクロール検知の閾値
    DEBOUNCE_TIME: 500, // デバウンス時間（ms）
    RETRY_DELAY: 500 // リトライ遅延時間（ms）
  },
  ZAP_CONFIG: {
    DEFAULT_LIMIT: 1,
    DEFAULT_COLOR_MODE: true,  // 追加
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
    ZAP_LIST: {
      INITIAL_BATCH: 30,
      REMAINING_BATCH: 30,
      PROFILE_BATCH: 30,
      MIN_HEIGHT: '100px',
    }
  },
  REQUEST_CONFIG: {
    METADATA_TIMEOUT: 20000,
    REQUEST_TIMEOUT: 2000,
    CACHE_DURATION: 300000,
  },
  PROFILE_CONFIG: {
    BATCH_SIZE: 20,
    BATCH_DELAY: 100,
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
      BATCH_DELAY: 100,
    },
    SUPPORTED_EVENT_KINDS: [1, 30023, 30030, 30009, 40, 42, 31990],
  },
  BATCH_PROCESSOR_CONFIG: {
    DEFAULT_BATCH_SIZE: 20,
    DEFAULT_BATCH_DELAY: 100,
    DEFAULT_MAX_CACHE_AGE: 1800000, // 30分
    DEFAULT_RELAY_URLS: [],
    TIMEOUT_DURATION: 500,
  },
};

export class ViewerConfig {
  constructor(identifier, relayUrls, colorMode = null) {
    this.identifier = identifier;
    this.relayUrls = relayUrls;
    // colorModeがnullの場合のみデフォルト値を使用
    this.isColorModeEnabled = colorMode === null ? 
      APP_CONFIG.ZAP_CONFIG.DEFAULT_COLOR_MODE : 
      String(colorMode).toLowerCase() === "true";
  }

  static determineColorMode(button) {
    if (!button) return APP_CONFIG.ZAP_CONFIG.DEFAULT_COLOR_MODE;
    if (!button.hasAttribute("data-zap-color-mode")) return APP_CONFIG.ZAP_CONFIG.DEFAULT_COLOR_MODE;
    const colorModeAttr = button.getAttribute("data-zap-color-mode");
    return String(colorModeAttr).toLowerCase() === "true";
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