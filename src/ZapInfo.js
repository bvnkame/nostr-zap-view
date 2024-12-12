import { formatIdentifier, parseZapEvent, encodeNpub, createDefaultZapInfo } from "./utils.js";
import { cacheManager } from "./CacheManager.js";
import { APP_CONFIG } from "./AppSettings.js";

export class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  static async createFromEvent(event, defaultIcon, config = {}) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    return await zapInfo.extractInfo(config);
  }

  static getAmountColorClass(amount, isColorModeEnabled) {
    // 明示的にbooleanに変換
    const colorMode = isColorModeEnabled === undefined ? 
    APP_CONFIG.ZAP_AMOUNT_CONFIG.DEFAULT_COLOR_MODE : 
      !!isColorModeEnabled;


    if (!colorMode) return APP_CONFIG.ZAP_AMOUNT_CONFIG.DISABLED_CLASS;
    return this.#calculateAmountColorClass(amount);
  }

  static #calculateAmountColorClass(amount) {
    const { THRESHOLDS, DEFAULT_CLASS } = APP_CONFIG.ZAP_AMOUNT_CONFIG;
    return THRESHOLDS.find(t => amount >= t.value)?.className || DEFAULT_CLASS;
  }

  async extractInfo(config = {}) {
    const eventId = this.event.id;
    const cachedInfo = cacheManager.getZapInfo(eventId);
    if (cachedInfo) {
      // キャッシュされた情報のカラーモードを更新
      cachedInfo.colorClass = ZapInfo.getAmountColorClass(
        cachedInfo.satsAmount,
        config.isColorModeEnabled
      );
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
        colorClass: ZapInfo.getAmountColorClass(
          satsAmount, 
          config?.isColorModeEnabled
        )
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

  static async batchExtractInfo(events, defaultIcon, isColorModeEnabled = true) {
    const results = new Map();
    await Promise.all(
      events.map(async event => {
        const zapInfo = new ZapInfo(event, defaultIcon);
        // 修正: isColorModeEnabled をオブジェクトとして渡す
        const info = await zapInfo.extractInfo({ isColorModeEnabled });
        results.set(event.id, info);
      })
    );
    return results;
  }
}