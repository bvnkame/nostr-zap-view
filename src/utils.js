import { ZAP_CONFIG as CONFIG } from "./ZapConfig.js";

// 定数定義
const CONSTANTS = {
  CACHE_MAX_SIZE: 1000,
  DEFAULT_ERROR_MESSAGE: "処理に失敗しました",
  SUPPORTED_TYPES: ["npub", "note", "nprofile", "nevent"],
};

// キャッシュマネージャー
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

// 共有キャッシュインスタンス
const decodedCache = new CacheManager();
const imageCache = new CacheManager();

// バリデーションユーティリティ
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

// デコード関連の関数
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
    console.error("識別子のデコードに失敗:", error);
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
    console.error("未対応の識別子タイプ:", type);
    return null;
  }

  return { req: reqCreator() };
}

// 数値フォーマットのヘルパー関数を追加
export function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

// 24時間以内かどうかをチェックする関数を追加
export function isWithin24Hours(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const hours24 = 24 * 60 * 60;
  return now - timestamp < hours24;
}

// formatNpub関数を汎用的な関数に変更
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
    console.error("Zap統計の取得に失敗:", error);
    return null;
  }
}

async function fetchZapStatsFromApi(identifier, decoded) {
  const { type, data } = decoded;
  const isProfile = type === "npub" || type === "nprofile";
  const endpoint = `https://api.nostr.band/v0/stats/${isProfile ? "profile" : "event"}/${identifier}`;

  const response = await fetch(endpoint);
  return response.json();
}

function formatZapStats(responseData) {
  if (!responseData?.stats) {
    console.error("無効なAPIレスポース形式:", responseData);
    return null;
  }

  const stats = Object.values(responseData.stats)[0];
  if (!stats) {
    console.error("Zap統計が見つかりません");
    return null;
  }

  return {
    count: stats.zaps_received?.count || stats.zaps?.count || 0,
    msats: stats.zaps_received?.msats || stats.zaps?.msats || 0,
    maxMsats: stats.zaps_received?.max_msats || stats.zaps?.max_msats || 0,
  };
}

export function getProfileDisplayName(profile) {
  return profile?.display_name || profile?.displayName || profile?.name || "Anonymous";
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
    // 制御文字を削除
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

// 画像関連の関数
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

// NIP-05検証関数を追加
export async function verifyNip05(nip05, pubkey) {
  if (!nip05 || !pubkey) return null;

  try {
    const profile = await window.NostrTools.nip05.queryProfile(nip05);
    return profile?.pubkey === pubkey ? nip05 : null;
  } catch (error) {
    console.error("NIP-05検証エラー:", error);
    return null;
  }
}
