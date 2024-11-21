import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

// Define constants
const CONSTANTS = {
  CACHE_MAX_SIZE: 1000,
  DEFAULT_ERROR_MESSAGE: "Processing failed",
  SUPPORTED_TYPES: ["npub", "note", "nprofile", "nevent"],
};

// Cache manager
class CacheManager {
  constructor(maxSize = CONSTANTS.CACHE_MAX_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }
}

// Shared cache instances
const decodedCache = new CacheManager();
const imageCache = new CacheManager();

// Validation utilities
const Validator = {
  isValidIdentifier: (identifier) => typeof identifier === "string" && identifier.length > 0,
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
export function decodeIdentifier(identifier, maxCount) {
  const cacheKey = `${identifier}:${maxCount}`;

  if (decodedCache.has(cacheKey)) {
    return decodedCache.get(cacheKey);
  }

  if (!Validator.isValidIdentifier(identifier) || !Validator.isValidCount(maxCount)) {
    throw new Error(CONFIG.ERRORS.DECODE_FAILED);
  }

  const decoded = safeNip19Decode(identifier);
  if (!decoded) return null;

  const result = createReqFromType(decoded.type, decoded.data, maxCount);
  if (result) {
    decodedCache.set(cacheKey, result);
  }

  return result;
}

function safeNip19Decode(identifier) {
  try {
    return window.NostrTools.nip19.decode(identifier);
  } catch (error) {
    console.error("Failed to decode identifier:", error);
    return null;
  }
}

function createReqFromType(type, data, maxCount) {
  const reqMap = {
    npub: () => ({ kinds: [9735], "#p": [data], limit: maxCount }),
    note: () => ({ kinds: [9735], "#e": [data], limit: maxCount }),
    nprofile: () => ({ kinds: [9735], "#p": [data.pubkey], limit: maxCount }),
    nevent: () => ({ kinds: [9735], "#e": [data.id], limit: maxCount }),
  };

  const reqCreator = reqMap[type];
  if (!reqCreator) {
    console.error("Unsupported identifier type:", type);
    return null;
  }

  return { req: reqCreator() };
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
  const decoded = safeNip19Decode(identifier);
  if (!decoded) return identifier;

  const { type } = decoded;
  return `${type.toLowerCase()}1${identifier.slice(5, 11)}...${identifier.slice(-4)}`;
}

export async function fetchZapStats(identifier) {
  if (!Validator.isValidIdentifier(identifier)) {
    throw new Error(CONFIG.ERRORS.DECODE_FAILED);
  }

  const decoded = safeNip19Decode(identifier);
  if (!decoded) return null;

  try {
    const stats = await fetchZapStatsFromApi(identifier, decoded);
    return formatZapStats(stats);
  } catch (error) {
    console.error("Failed to fetch Zap stats:", error);
    return null;
  }
}

async function fetchZapStatsFromApi(identifier, decoded) {
  const { type, data } = decoded;
  const isProfile = type === "npub" || type === "nprofile";
  const endpoint = `https://api.nostr.band/v0/stats/${isProfile ? "profile" : "event"}/${identifier}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(endpoint, { 
      signal: controller.signal 
    });
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatZapStats(responseData) {
  if (!responseData?.stats) {
    console.error("Invalid API response format:", responseData);
    return null;
  }

  const stats = Object.values(responseData.stats)[0];
  if (!stats) {
    console.error("Zap stats not found");
    return null;
  }

  return {
    count: stats.zaps_received?.count || stats.zaps?.count || 0,
    msats: stats.zaps_received?.msats || stats.zaps?.msats || 0,
    maxMsats: stats.zaps_received?.max_msats || stats.zaps?.max_msats || 0,
  };
}

export function getProfileDisplayName(profile) {
  return profile?.display_name || profile?.displayName || profile?.name || "nameless";
}

export async function parseZapEvent(event, defaultIcon) {
  const { pubkey, content } = await parseDescriptionTag(event);
  const satsText = await parseBolt11(event);

  return {
    pubkey,
    content,
    satsText,
  };
}

export function parseDescriptionTag(event) {
  const descriptionTag = event.tags.find((tag) => tag[0] === "description")?.[1];
  if (!descriptionTag) return { pubkey: null, content: "" };

  try {
    // Remove control characters
    const sanitizedDescription = descriptionTag.replace(/[\u0000-\u001F\u007F]/g, "");
    const parsed = JSON.parse(sanitizedDescription);
    return { pubkey: parsed.pubkey, content: parsed.content || "" };
  } catch (error) {
    console.error("Description tag parse error:", error);
    return { pubkey: null, content: "" };
  }
}

export async function parseBolt11(event) {
  const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
  if (!bolt11Tag) return "Amount: Unknown";

  try {
    const decoded = window.decodeBolt11(bolt11Tag);
    const amountMsat = decoded.sections.find((section) => section.name === "amount")?.value;
    return amountMsat ? `${formatNumber(Math.floor(amountMsat / 1000))} sats` : "Amount: Unknown";
  } catch (error) {
    console.error("BOLT11 decode error:", error);
    return "Amount: Unknown";
  }
}

// Image related functions
export async function preloadImage(url) {
  if (!url || !Validator.isValidUrl(url)) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  try {
    const validatedUrl = await loadAndValidateImage(url);
    imageCache.set(url, validatedUrl);
    return validatedUrl;
  } catch (error) {
    console.error("Image preload error:", error);
    imageCache.set(url, null);
    return null;
  }
}

async function loadAndValidateImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(escapeHTML(url));
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
