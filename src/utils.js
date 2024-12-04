import { ZAP_CONFIG as CONFIG, APP_CONFIG } from "./AppSettings.js";
import { cacheManager } from "./CacheManager.js";

// Define constants
const CONSTANTS = {
  DEFAULT_ERROR_MESSAGE: "Processing failed",
  SUPPORTED_TYPES: ["npub", "note", "nprofile", "nevent"],
};

// Validation utilities
const Validator = {
  isValidIdentifier: (identifier) =>
    typeof identifier === "string" && identifier.length > 0,
  isValidCount: (count) => typeof count === "number" && count > 0,
  isValidUrl: (url) => {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  isValidTimestamp: (timestamp) => {
    return typeof timestamp === "number" && timestamp > 0;
  },
};

// Decoding related functions
export function decodeIdentifier(identifier, since = null) {
  const cacheKey = `${identifier}:${since}`;

  if (cacheManager.hasDecoded(cacheKey)) {
    return cacheManager.getDecoded(cacheKey);
  }

  if (!Validator.isValidIdentifier(identifier)) {
    throw new Error(CONFIG.ERRORS.DECODE_FAILED);
  }

  const decoded = safeNip19Decode(identifier);
  if (!decoded) return null;

  const result = createReqFromType(decoded.type, decoded.data, since);
  if (result) {
    cacheManager.setDecoded(cacheKey, result);
  }

  return result;
}

// Change from function to export function
export function safeNip19Decode(identifier) {
  try {
    return window.NostrTools.nip19.decode(identifier);
  } catch (error) {
    console.debug("Failed to decode identifier:", error);
    return null;
  }
}

function createReqFromType(type, data, since) {
  const baseReq = {
    npub: () => ({ kinds: [9735], "#p": [data] }),
    note: () => ({ kinds: [9735], "#e": [data] }),
    nprofile: () => ({ kinds: [9735], "#p": [data.pubkey] }),
    nevent: () => ({ kinds: [9735], "#e": [data.id] }),
  };

  const reqCreator = baseReq[type];
  if (!reqCreator) {
    console.error("Unsupported identifier type:", type);
    return null;
  }

  const req = reqCreator();

  // 初期ロードと追加ロードで異なる件数を使用
  req.limit = since
    ? APP_CONFIG.ADDITIONAL_LOAD_COUNT
    : APP_CONFIG.INITIAL_LOAD_COUNT;

  if (since) {
    req.until = since;
  }

  return { req };
}

// Add helper function for number formatting
export function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

// Add function to check if within 24 hours
export function isWithin24Hours(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const hours24 = 24 * 60 * 60;
  return now - timestamp < hours24;
}

// Change formatNpub function to a generic function
export function formatIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") {
    return "unknown";
  }

  try {
    const decoded = window.NostrTools.nip19.decode(identifier);
    const { type } = decoded;
    return `${type.toLowerCase()}1${identifier.slice(
      5,
      11
    )}...${identifier.slice(-4)}`;
  } catch (error) {
    console.debug("Failed to format identifier:", error);
    return "unknown";
  }
}

// Add function to check identifier type
export function isProfileIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return false;
  return identifier.startsWith("npub1") || identifier.startsWith("nprofile1");
}

export function isEventIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return false;
  return identifier.startsWith("note1") || identifier.startsWith("nevent1");
}

export function getProfileDisplayName(profile) {
  return profile?.display_name || profile?.name || "nameless";
}

export async function parseZapEvent(event) {
  const { pubkey, content } = parseDescriptionTag(event);
  const satsText = await parseBolt11(event);

  return {
    pubkey,
    content,
    satsText,
  };
}

export function parseDescriptionTag(event) {
  const descriptionTag = event.tags.find(
    (tag) => tag[0] === "description"
  )?.[1];
  if (!descriptionTag) return { pubkey: null, content: "" };

  try {
    // 制御文字の除去と不正なエスケープシーケンスの修正
    const sanitizedDescription = descriptionTag
      .replace(/[\u0000-\u001F\u007F]/g, "") // 制御文字の除去
      .replace(/\\([^"\\\/bfnrtu])/g, "$1"); // 不正なエスケープシーケンスの修正

    const parsed = JSON.parse(sanitizedDescription);

    // pubkeyの型チェックと正規化
    const pubkey =
      typeof parsed.pubkey === "string"
        ? parsed.pubkey
        : typeof parsed.pubkey === "object" && parsed.pubkey !== null
        ? parsed.pubkey.toString()
        : null;

    return {
      pubkey: pubkey,
      content: typeof parsed.content === "string" ? parsed.content : "",
    };
  } catch (error) {
    console.warn("Description tag parse warning:", error, {
      tag: descriptionTag,
    });
    return { pubkey: null, content: "" };
  }
}

export async function parseBolt11(event) {
  const bolt11Tag = event.tags.find(
    (tag) => tag[0].toLowerCase() === "bolt11"
  )?.[1];
  if (!bolt11Tag) return "Amount: Unknown";

  try {
    const decoded = window.decodeBolt11(bolt11Tag);
    const amountMsat = decoded.sections.find(
      (section) => section.name === "amount"
    )?.value;
    return amountMsat
      ? `${formatNumber(Math.floor(amountMsat / 1000))} sats`
      : "Amount: Unknown";
  } catch (error) {
    console.error("BOLT11 decode error:", error);
    return "Amount: Unknown";
  }
}

export function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Add NIP-05 verification function
export async function verifyNip05(nip05, pubkey) {
  if (!nip05 || !pubkey) return null;

  try {
    const profile = await window.NostrTools.nip05.queryProfile(nip05);
    return profile?.pubkey === pubkey ? nip05 : null;
  } catch (error) {
    console.error("NIP-05 verification error:", error);
    return null;
  }
}

// Add secure URL sanitization function
export function sanitizeImageUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    // Allow only http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    // パラメータとハッシュは保持するように変更
    return parsed.href;
  } catch {
    return null;
  }
}

// Add NIP-19 encoding utilities
export function encodeNpub(pubkey) {
  try {
    return window.NostrTools.nip19.npubEncode(pubkey);
  } catch (error) {
    console.debug("Failed to encode npub:", error);
    return null;
  }
}

export function encodeNprofile(pubkey, relays = []) {
  try {
    return window.NostrTools.nip19.nprofileEncode({
      pubkey,
      relays,
    });
  } catch (error) {
    console.debug("Failed to encode nprofile:", error);
    return null;
  }
}

export function encodeNevent(id, kind, pubkey, relays = []) {
  try {
    return window.NostrTools.nip19.neventEncode({
      id,
      kind,
      pubkey,
      relays,
    });
  } catch (error) {
    console.debug("Failed to encode nevent:", error);
    return null;
  }
}

export function encodeNaddr(kind, pubkey, identifier, relays = []) {
  try {
    return window.NostrTools.nip19.naddrEncode({
      kind,
      pubkey,
      identifier,
      relays,
    });
  } catch (error) {
    console.debug("Failed to encode naddr:", error);
    return null;
  }
}

// Add function to extract reference from tags
export function extractReferenceFromTags(event) {
  if (!event.tags) return null;

  const eTag = event.tags.find((tag) => tag[0] === "e");
  const pTag = event.tags.find((tag) => tag[0] === "p");

  if (!eTag) return null;

  return {
    id: eTag[1],
    kind: parseInt(eTag[3], 10) || 1,
    pubkey: pTag?.[1] || event.pubkey || "",
    content: event.content || "",
    tags: event.tags || [],
  };
}

// Add function to create default zap info
export function createDefaultZapInfo(event, defaultIcon) {
  return {
    satsText: "Amount: Unknown",
    satsAmount: 0,
    comment: "",
    pubkey: "",
    created_at: event.created_at,
    displayIdentifier: "anonymous",
    senderName: "anonymous",
    senderIcon: defaultIcon,
    reference: null,
  };
}

// Add function to get amount color class
export function getAmountColorClass(amount, thresholds) {
  for (const threshold of thresholds) {
    if (amount >= threshold.value) return threshold.className;
  }
  return "";
}

// Add function to check if color mode is enabled
export function isColorModeEnabled(button, defaultColorMode) {
  const colorModeAttr = button?.getAttribute("data-zap-color-mode");
  return !colorModeAttr || !["true", "false"].includes(colorModeAttr)
    ? defaultColorMode
    : colorModeAttr === "true";
}

// Add function to create no zaps message
export function createNoZapsMessage(dialogConfig) {
  return dialogConfig.NO_ZAPS_MESSAGE;
}

export const isValidCount = (count) => Number.isInteger(count) && count > 0;
