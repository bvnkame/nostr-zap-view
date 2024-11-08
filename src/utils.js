// src/utils.js
export function decodeIdentifier(identifier, maxCount) {
  try {
    const { type, data } = window.NostrTools.nip19.decode(identifier);
    let req;

    switch (type) {
      case "npub":
        req = { kinds: [9735], "#p": [data], limit: maxCount };
        break;
      case "note":
        req = { kinds: [9735], "#e": [data], limit: maxCount };
        break;
      case "nprofile":
        req = { kinds: [9735], "#p": [data.pubkey], limit: maxCount };
        break;
      case "nevent":
        req = { kinds: [9735], "#e": [data.id], limit: maxCount };
        break;
      default:
        console.error("Unsupported identifier type:", type);
        return null;
    }

    return { req };
  } catch (error) {
    console.error("Failed to decode identifier:", error);
    return null;
  }
}

// 数値フォーマットのヘルパー関数を追加
export function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

// formatNpub関数を汎用的な関数に変更
export function formatIdentifier(identifier) {
  try {
    const { type, data } = window.NostrTools.nip19.decode(identifier);
    const prefix = type.toLowerCase();
    return `${prefix}1${identifier.slice(5, 11)}...${identifier.slice(-4)}`;
  } catch (error) {
    console.error("Failed to format identifier:", error);
    return identifier;
  }
}

export async function fetchZapStats(identifier) {
  try {
    const { type, data } = window.NostrTools.nip19.decode(identifier);

    // 識別子の種類に応じてエンドポイントを決定
    const endpoint = type === "npub" || type === "nprofile" ? "https://api.nostr.band/v0/stats/profile/" : "https://api.nostr.band/v0/stats/event/";

    const response = await fetch(`${endpoint}${identifier}`);
    const responseData = await response.json();

    // データの存在確認
    if (!responseData || !responseData.stats) {
      console.error("Invalid API response format:", responseData);
      return null;
    }

    // 統計データの抽出
    let stats;
    if (type === "npub" || type === "nprofile") {
      // プロフィールの場合、pubkeyから直接zaps_receivedを取得
      const pubkey = type === "npub" ? data : data.pubkey;
      stats = responseData.stats[pubkey]?.zaps_received;
    } else {
      // イベントの場合、event_idからzapsを取得
      const eventId = type === "note" ? data : data.id;
      stats = responseData.stats[eventId]?.zaps;
    }

    // 必要なデータが存在しない場合はnullを返す
    if (!stats) {
      console.error("Zap statistics not found in response");
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
