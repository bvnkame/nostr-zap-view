import { formatIdentifier, parseZapEvent, encodeNpub, createDefaultZapInfo } from "./utils.js";
import { cacheManager } from "./CacheManager.js";
import { ZAP_AMOUNT_CONFIG } from "./AppSettings.js";

export class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  static async createFromEvent(event, defaultIcon) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    return await zapInfo.extractInfo();
  }

  static getAmountColorClass(amount, isColorModeEnabled = true) {
    if (!isColorModeEnabled) return "";
    return this.#calculateAmountColorClass(amount);
  }

  static #calculateAmountColorClass(amount) {
    const thresholds = ZAP_AMOUNT_CONFIG.THRESHOLDS;
    for (const threshold of thresholds) {
      if (amount >= threshold.value) return threshold.className;
    }
    return "zap-amount-default"; // 既定のクラスを追加
  }

  async extractInfo() {
    const eventId = this.event.id;
    const cachedInfo = cacheManager.getZapInfo(eventId);
    if (cachedInfo) return cachedInfo;

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
        colorClass: ZapInfo.getAmountColorClass(satsAmount)
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

  static async batchExtractInfo(events, defaultIcon) {
    const results = new Map();
    await Promise.all(
      events.map(async event => {
        const zapInfo = new ZapInfo(event, defaultIcon);
        const info = await zapInfo.extractInfo();
        results.set(event.id, info);
      })
    );
    return results;
  }
}