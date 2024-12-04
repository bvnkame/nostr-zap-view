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
    maxCount: 5,
    colorMode: true, // Added: Default value for color mode
  },
  INITIAL_LOAD_COUNT: 15, // 追加：初期ロード件数のデフォルト値
  ADDITIONAL_LOAD_COUNT: 20, // 追加：追加ロード件数
  INFINITE_SCROLL: {
    ROOT_MARGIN: '400px',
    THRESHOLD: [0.1]
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
  THRESHOLDS: [
    { value: 10000, className: "zap-amount-10k" },
    { value: 5000, className: "zap-amount-5k" },
    { value: 2000, className: "zap-amount-2k" },
    { value: 1000, className: "zap-amount-1k" },
    { value: 500, className: "zap-amount-500" },
    { value: 200, className: "zap-amount-200" },
    { value: 100, className: "zap-amount-100" },
  ]
};

// Add new settings for zap dialog
export const DIALOG_CONFIG = {
  MAX_DISPLAY_LIMIT: 50,
  DEFAULT_TITLE: "To ",
  NO_ZAPS_MESSAGE: `
    <div class="no-zaps-message">
      No Zaps yet!<br>Send the first Zap!
    </div>
  `,
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
  constructor(identifier, maxCount, relayUrls) {
    this.identifier = identifier;
    // Use default value if maxCount is invalid
    this.maxCount = this.validateMaxCount(maxCount)
      ? maxCount
      : APP_CONFIG.DEFAULT_OPTIONS.maxCount;
    this.relayUrls = relayUrls;
  }

  validateMaxCount(count) {
    return typeof count === "number" && !isNaN(count) && count > 0;
  }

  static fromButton(button) {
    if (!button) throw new Error(ZAP_CONFIG.ERRORS.BUTTON_NOT_FOUND);
    const maxCount = parseInt(button.getAttribute("data-max-count"), 10);
    return new ViewerConfig(
      button.getAttribute("data-nzv-id"),
      maxCount, // Handle parseInt result in constructor even if NaN
      button.getAttribute("data-relay-urls").split(",")
    );
  }
}