import { formatIdentifier, parseZapEvent, encodeNpub, extractReferenceFromTags, createDefaultZapInfo } from "./utils.js";

export class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  async extractInfo() {
    try {
      const { pubkey, content, satsText } = await parseZapEvent(this.event);
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
      const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

      // referenceの抽出を単純化
      const reference = extractReferenceFromTags(this.event);

      return {
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
    } catch (error) {
      console.error("Failed to extract zap info:", error, this.event);
      return createDefaultZapInfo(this.event, this.defaultIcon);
    }
  }
}