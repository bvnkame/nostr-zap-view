import { formatIdentifier, parseZapEvent, encodeNpub, createDefaultZapInfo } from "./utils.js";
import { cacheManager } from "./CacheManager.js";

export class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  async extractInfo() {
    const eventId = this.event.id;
    
    const cachedInfo = cacheManager.getZapInfo(eventId);
    if (cachedInfo) {
      return cachedInfo;
    }

    try {
      const { pubkey, content, satsText } = await parseZapEvent(this.event);
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
      const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

      const reference = this.event.reference || null;
      
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

      cacheManager.setZapInfo(eventId, info);
      return info;

    } catch (error) {
      console.error("Failed to extract zap info:", error, this.event);
      const defaultInfo = createDefaultZapInfo(this.event, this.defaultIcon);
      cacheManager.setZapInfo(eventId, defaultInfo);
      return defaultInfo;
    }
  }
}