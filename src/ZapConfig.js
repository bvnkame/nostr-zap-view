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

// Modify Zap-related settings
export const ZAP_CONFIG = {
  SUBSCRIPTION_TIMEOUT: 20000, // Changed: Unnested
  DEFAULT_LIMIT: 1, // Changed: Unnested
  API_TIMEOUT: 3000, // Added: API timeout setting
  ERRORS: {
    DIALOG_NOT_FOUND: "Zap dialog not found",
    BUTTON_NOT_FOUND: "Fetch button not found",
    DECODE_FAILED: "Failed to decode identifier",
  },
};

// Profile management settings
export const PROFILE_CONFIG = {
  BATCH_SIZE: 10,
  BATCH_DELAY: 100,
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
      button.getAttribute("data-nzv-identifier"),
      maxCount, // Handle parseInt result in constructor even if NaN
      button.getAttribute("data-relay-urls").split(",")
    );
  }
}
