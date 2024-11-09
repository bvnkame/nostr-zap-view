import { CONFIG } from "./ZapManager.js";

// 型チェック用のユーティリティ
const TypeChecker = {
  isValidIdentifier: (identifier) => typeof identifier === "string" && identifier.length > 0,
  isValidCount: (count) => typeof count === "number" && count > 0,
};

// src/utils.js
export function decodeIdentifier(identifier, maxCount) {
  if (!TypeChecker.isValidIdentifier(identifier) || !TypeChecker.isValidCount(maxCount)) {
    throw new Error(CONFIG.ERRORS.DECODE_FAILED);
  }

  const decoded = safeNip19Decode(identifier);
  if (!decoded) return null;

  return createReqFromType(decoded.type, decoded.data, maxCount);
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

// formatNpub関数を汎用的な関数に変更
export function formatIdentifier(identifier) {
  const decoded = safeNip19Decode(identifier);
  if (!decoded) return identifier;

  const { type } = decoded;
  return `${type.toLowerCase()}1${identifier.slice(5, 11)}...${identifier.slice(-4)}`;
}

export async function fetchZapStats(identifier) {
  if (!TypeChecker.isValidIdentifier(identifier)) {
    throw new Error(CONFIG.ERRORS.DECODE_FAILED);
  }

  const decoded = safeNip19Decode(identifier);
  if (!decoded) return null;

  const { type, data } = decoded;
  const isProfile = type === "npub" || type === "nprofile";
  const endpoint = `https://api.nostr.band/v0/stats/${isProfile ? "profile" : "event"}/${identifier}`;

  try {
    const response = await fetch(endpoint);
    const responseData = await response.json();

    if (!responseData?.stats) {
      console.error("無効なAPIレスポース形式:", responseData);
      return null;
    }

    const statsKey = isProfile ? (type === "npub" ? data : data.pubkey) : type === "note" ? data : data.id;

    const stats = isProfile ? responseData.stats[statsKey]?.zaps_received : responseData.stats[statsKey]?.zaps;

    if (!stats) {
      console.error("Zap統計が見つかりません");
      return null;
    }

    return {
      count: stats.count || 0,
      msats: stats.msats || 0,
      maxMsats: stats.max_msats || 0,
    };
  } catch (error) {
    console.error("Zap統計の取得に失敗:", error);
    return null;
  }
}

// プロフィール関連のヘルパー関数
export function getProfileDisplayName(profile) {
  return profile?.display_name || profile?.displayName || profile?.name || "Anonymous";
}

// Zap情報解析のヘルパー関数
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
    const parsed = JSON.parse(descriptionTag);
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
