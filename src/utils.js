import { APP_CONFIG } from "./AppSettings.js";
import { cacheManager } from "./CacheManager.js";
import defaultIcon from "./assets/nostr-icon.svg";

// Core constants
const CONSTANTS = {
  DEFAULT_ERROR_MESSAGE: "Processing failed",
  SUPPORTED_TYPES: ["npub", "note", "nprofile", "nevent"],
  PROTOCOLS: ["http:", "https:"],
};

// Validation utilities
const Validator = {
  isValidIdentifier: (identifier) => typeof identifier === "string" && identifier.length > 0,
  isValidCount: (count) => typeof count === "number" && count > 0,
  isValidUrl: (url) => {
    try {
      return CONSTANTS.PROTOCOLS.includes(new URL(url).protocol);
    } catch {
      return false;
    }
  },
  isValidTimestamp: (timestamp) => typeof timestamp === "number" && timestamp > 0,
  isProfileIdentifier: (identifier) => {
    if (!identifier || typeof identifier !== "string") return false;
    return identifier.startsWith("npub1") || identifier.startsWith("nprofile1");
  },
  isEventIdentifier: (identifier) => {
    if (!identifier || typeof identifier !== "string") return false;
    return identifier.startsWith("note1") || identifier.startsWith("nevent1");
  }
};

// Decoder utilities
const Decoder = {
  safeNip19Decode: (identifier) => {
    try {
      return window.NostrTools.nip19.decode(identifier);
    } catch (error) {
      console.debug("Failed to decode identifier:", error);
      return null;
    }
  },
  createReqFromType: (type, data, since) => {
    const baseReq = {
      npub: () => ({ kinds: [9735], "#p": [data] }),
      note: () => ({ kinds: [9735], "#e": [data] }),
      nprofile: () => ({ kinds: [9735], "#p": [data.pubkey] }),
      nevent: () => ({ kinds: [9735], "#e": [data.id] })
    };

    const reqCreator = baseReq[type];
    if (!reqCreator) {
      console.error("Unsupported identifier type:", type);
      return null;
    }

    const req = reqCreator();
    req.limit = since ? APP_CONFIG.REQ_CONFIG.ADDITIONAL_LOAD_COUNT : APP_CONFIG.REQ_CONFIG.INITIAL_LOAD_COUNT;
    if (since) req.until = since;

    return { req };
  }
};

// Encoder utilities
const Encoder = {
  encodeNpub: (pubkey) => {
    try {
      return window.NostrTools.nip19.npubEncode(pubkey);
    } catch (error) {
      console.debug("Failed to encode npub:", error);
      return null;
    }
  },
  encodeNprofile: (pubkey, relays = []) => {
    try {
      return window.NostrTools.nip19.nprofileEncode({
        pubkey,
        relays,
      });
    } catch (error) {
      console.debug("Failed to encode nprofile:", error);
      return null;
    }
  },
  encodeNevent: (id, kind, pubkey, relays = []) => {
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
  },
  encodeNaddr: (kind, pubkey, identifier, relays = []) => {
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
};

// Formatter utilities
const Formatter = {
  formatNumber: (num) => new Intl.NumberFormat().format(num),
  formatIdentifier: (identifier) => {
    if (!identifier || typeof identifier !== "string") return "unknown";
    try {
      const decoded = window.NostrTools.nip19.decode(identifier);
      return `${decoded.type.toLowerCase()}1${identifier.slice(5, 11)}...${identifier.slice(-4)}`;
    } catch (error) {
      console.debug("Failed to format identifier:", error);
      return "unknown";
    }
  },
  escapeHTML: (str) => {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
};

// Zap utilities
const ZapUtils = {
  parseZapEvent: async (event) => {
    const { pubkey, content } = ZapUtils.parseDescriptionTag(event);
    const satsText = await ZapUtils.parseBolt11(event);
    return { pubkey, content, satsText };
  },
  parseDescriptionTag: (event) => {
    const descriptionTag = event.tags.find(
      (tag) => tag[0] === "description"
    )?.[1];
    if (!descriptionTag) return { pubkey: null, content: "" };

    try {
      const sanitizedDescription = sanitizeJsonString(descriptionTag);

      let parsed;
      try {
        parsed = JSON.parse(sanitizedDescription);
      } catch {
        // 最後の手段としてJSONを再構築
        const match = sanitizedDescription.match(/"pubkey"\s*:\s*"([^"]+)"|"content"\s*:\s*"([^"]+)"/g);
        if (!match) throw new Error('Invalid JSON structure');

        parsed = {};
        match.forEach(item => {
          const [key, value] = item.split(':').map(s => s.trim().replace(/"/g, ''));
          parsed[key] = value;
        });
      }

      // pubkeyの型チェックと正規化
      let pubkey = null;
      if (parsed.pubkey) {
        pubkey = typeof parsed.pubkey === "string" 
          ? parsed.pubkey 
          : String(parsed.pubkey);
      }

      // contentの型チェックと正規化
      const content = typeof parsed.content === "string" 
        ? parsed.content.trim() 
        : "";

      return { pubkey, content };
    } catch (error) {
      console.warn("Description tag parse warning:", error, {
        tag: descriptionTag,
        sanitized: sanitizedDescription
      });
      return { pubkey: null, content: "" };
    }
  },
  parseBolt11: async (event) => {
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
        ? `${Formatter.formatNumber(Math.floor(amountMsat / 1000))} sats`
        : "Amount: Unknown";
    } catch (error) {
      console.error("BOLT11 decode error:", error);
      return "Amount: Unknown";
    }
  },
  createDefaultZapInfo: (event) => {
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
};

// Time-related utilities
function isWithin24Hours(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const hours24 = 24 * 60 * 60;
  return now - timestamp < hours24;
}

// Keep existing decodeIdentifier as main export
function decodeIdentifier(identifier, since = null) {
  const cacheKey = `${identifier}:${since}`;
  if (cacheManager.hasDecoded(cacheKey)) return cacheManager.getDecoded(cacheKey);
  
  if (!Validator.isValidIdentifier(identifier)) throw new Error(APP_CONFIG.ZAP_CONFIG.ERRORS.DECODE_FAILED);
  
  const decoded = Decoder.safeNip19Decode(identifier);
  if (!decoded) return null;
  
  const result = Decoder.createReqFromType(decoded.type, decoded.data, since);
  if (result) cacheManager.setDecoded(cacheKey, result);
  
  return result;
}

function getProfileDisplayName(profile) {
  return profile?.display_name || profile?.name || "nameless";
}

async function verifyNip05(nip05, pubkey) {
  if (!nip05 || !pubkey) return null;

  try {
    const profile = await window.NostrTools.nip05.queryProfile(nip05);
    return profile?.pubkey === pubkey ? nip05 : null;
  } catch (error) {
    console.error("NIP-05 verification error:", error);
    return null;
  }
}

function sanitizeImageUrl(url) {
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

const isValidCount = (count) => Number.isInteger(count) && count > 0;

// --- Move individual functions out of Formatter ---
function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

function formatIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return "unknown";
  try {
    const decoded = window.NostrTools.nip19.decode(identifier);
    return `${decoded.type.toLowerCase()}1${identifier.slice(5, 11)}...${identifier.slice(-4)}`;
  } catch (error) {
    console.debug("Failed to format identifier:", error);
    return "unknown";
  }
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Move individual functions out of Encoder ---
function encodeNpub(pubkey) {
  try {
    return window.NostrTools.nip19.npubEncode(pubkey);
  } catch (error) {
    console.debug("Failed to encode npub:", error);
    return null;
  }
}

function encodeNprofile(pubkey, relays = []) {
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

function encodeNevent(id, kind, pubkey, relays = []) {
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

function encodeNaddr(kind, pubkey, identifier, relays = []) {
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

// --- Move individual functions out of Validator ---
function isEventIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return false;
  return identifier.startsWith("note1") || identifier.startsWith("nevent1");
}

function isProfileIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") return false;
  return identifier.startsWith("npub1") || identifier.startsWith("nprofile1");
}

function isValidIdentifier(identifier) {
  return typeof identifier === "string" && identifier.length > 0;
}

// --- Move individual functions out of ZapUtils ---
async function parseZapEvent(event) {
  const { pubkey, content } = parseDescriptionTag(event);
  const satsText = await parseBolt11(event);
  return { pubkey, content, satsText };
}

function createDefaultZapInfo(event, defaultIcon) {
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

function parseDescriptionTag(event) {
  const descriptionTag = event.tags.find(
    (tag) => tag[0] === "description"
  )?.[1];
  if (!descriptionTag) return { pubkey: null, content: "" };

  try {
    const sanitizedDescription = sanitizeJsonString(descriptionTag);

    let parsed;
    try {
      parsed = JSON.parse(sanitizedDescription);
    } catch {
      // 最後の手段としてJSONを再構築
      const match = sanitizedDescription.match(/"pubkey"\s*:\s*"([^"]+)"|"content"\s*:\s*"([^"]+)"/g);
      if (!match) throw new Error('Invalid JSON structure');

      parsed = {};
      match.forEach(item => {
        const [key, value] = item.split(':').map(s => s.trim().replace(/"/g, ''));
        parsed[key] = value;
      });
    }

    // pubkeyの型チェックと正規化
    let pubkey = null;
    if (parsed.pubkey) {
      pubkey = typeof parsed.pubkey === "string" 
        ? parsed.pubkey 
        : String(parsed.pubkey);
    }

    // contentの型チェックと正規化
    const content = typeof parsed.content === "string" 
      ? parsed.content.trim() 
      : "";

    return { pubkey, content };
  } catch (error) {
    console.warn("Description tag parse warning:", error, {
      tag: descriptionTag,
      sanitized: sanitizedDescription
    });
    return { pubkey: null, content: "" };
  }
}

async function parseBolt11(event) {
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

// --- Move individual function out of Decoder ---
function safeNip19Decode(identifier) {
  try {
    return window.NostrTools.nip19.decode(identifier);
  } catch (error) {
    console.debug("Failed to decode identifier:", error);
    return null;
  }
}

// Sanitize utilities
function sanitizeJsonString(jsonStr) {
  return jsonStr
    // 制御文字の除去
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // バックスラッシュのエスケープを修正
    .replace(/\\\\/g, '\\')
    // 不正なエスケープシーケンスの修正
    .replace(/\\(?!(["\\\/bfnrt]|u[0-9a-fA-F]{4}))/g, '')
    // 重複したエスケープの修正
    .replace(/\\+(["\\/bfnrt])/g, '\\$1')
    // Unicode エスケープシーケンスの修正
    .replace(/\\u(?![0-9a-fA-F]{4})/g, '');
}

// --- Remove 'export' from individual function declarations ---

// Consolidate all exports into a single export statement to remove duplicates
export {
  // Individual functions from Formatter
  formatNumber,
  formatIdentifier,
  escapeHTML,

  // Individual functions from Encoder
  encodeNpub,
  encodeNprofile,
  encodeNevent,
  encodeNaddr,

  // Individual functions from Validator
  isEventIdentifier,
  isProfileIdentifier,
  isValidIdentifier,

  // Individual functions from ZapUtils
  parseZapEvent,
  createDefaultZapInfo,
  parseDescriptionTag,
  parseBolt11,

  // Individual function from Decoder
  safeNip19Decode,

  // Standalone functions
  isWithin24Hours,
  decodeIdentifier,
  getProfileDisplayName,
  verifyNip05,
  sanitizeImageUrl,
  isValidCount,
  sanitizeJsonString
};
