import { formatIdentifier, parseZapEvent, encodeNpub, createDefaultZapInfo } from "./utils.js";

export class ZapInfo {
  static infoCache = new Map();

  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  async extractInfo() {
    const eventId = this.event.id;
    
    // キャッシュにヒットした場合はキャッシュから返す
    if (ZapInfo.infoCache.has(eventId)) {
      return ZapInfo.infoCache.get(eventId);
    }

    try {
      const { pubkey, content, satsText } = await parseZapEvent(this.event);
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
      const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

      const reference = this.event.reference || null;
      console.log("[extractInfo] Reference:", reference);
      
      const info = {
        satsText,
        satsAmount,
        comment: content || "",
        pubkey: normalizedPubkey || "",
        created_at: this.event.created_at,
        displayIdentifier: normalizedPubkey
          ? formatIdentifier(encodeNpub(normalizedPubkey))
          : "anonymous",
        senderName: null,
        senderIcon: null,
        reference,
      };

      // 結果をキャッシュに保存
      ZapInfo.infoCache.set(eventId, info);
      return info;

    } catch (error) {
      console.error("Failed to extract zap info:", error, this.event);
      const defaultInfo = createDefaultZapInfo(this.event, this.defaultIcon);
      ZapInfo.infoCache.set(eventId, defaultInfo);
      return defaultInfo;
    }
  }

  // キャッシュをクリアするメソッドを追加
  static clearCache() {
    ZapInfo.infoCache.clear();
  }

  // 特定のイベントのキャッシュをクリアするメソッドを追加
  static clearEventCache(eventId) {
    ZapInfo.infoCache.delete(eventId);
  }
}