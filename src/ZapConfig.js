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

export class ZapConfig {
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
    return new ZapConfig(
      button.getAttribute("data-nzv-id"),
      maxCount, // Handle parseInt result in constructor even if NaN
      button.getAttribute("data-relay-urls").split(",")
    );
  }
}
