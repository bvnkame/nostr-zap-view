
import { formatIdentifier, parseZapEvent, encodeNpub, extractReferenceFromTags, createDefaultZapInfo } from "./utils.js";

export class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  async extractInfo() {
    try {
      const { pubkey, content, satsText } = await parseZapEvent(
        this.event,
        this.defaultIcon
      );
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
      const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

      // referenceの抽出を単純化
      const reference = this.event.reference || extractReferenceFromTags(this.event);

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

  #extractReferenceFromTags() {
    if (!this.event.tags) return null;
    
    const eTag = this.event.tags.find((tag) => tag[0] === "e");
    const pTag = this.event.tags.find((tag) => tag[0] === "p");
    
    if (!eTag) return null;

    return {
      id: eTag[1],
      kind: parseInt(eTag[3], 10) || 1,
      pubkey: pTag?.[1] || this.event.pubkey || "",
      content: this.event.content || "",
      tags: this.event.tags || [],
    };
  }

  #createDefaultInfo() {
    return {
      satsText: "Amount: Unknown",
      satsAmount: 0,
      comment: "",
      pubkey: "",
      created_at: this.event.created_at,
      displayIdentifier: "anonymous",
      senderName: "anonymous",
      senderIcon: this.defaultIcon,
      reference: null,
    };
  }
}