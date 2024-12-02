
import { escapeHTML, isEventIdentifier, encodeNevent } from "./utils.js";
import arrowRightIcon from "./assets/arrow_right.svg";
import quickReferenceIcon from "./assets/link.svg";

export class DialogComponents {
  static createUIComponents(zapInfo, viewId) {
    const iconComponent = this.createIconComponent(zapInfo);
    const nameComponent = this.createNameComponent(zapInfo);
    const pubkeyComponent = this.createPubkeyComponent(zapInfo, viewId);
    const referenceComponent = this.createReferenceComponent(zapInfo, viewId);

    return {
      iconComponent,
      nameComponent,
      pubkeyComponent,
      referenceComponent,
    };
  }

  static createIconComponent({ senderIcon, senderName }) {
    return `<div class="zap-placeholder-icon skeleton"></div>`;
  }

  static createNameComponent({ senderName }) {
    return senderName
      ? `<span class="sender-name">${escapeHTML(senderName)}</span>`
      : `<div class="zap-placeholder-name skeleton"></div>`;
  }

  static createPubkeyComponent({ pubkey, displayIdentifier, reference }, viewId) {
    const identifier =
      document
        .querySelector(`button[data-zap-view-id="${viewId}"]`)
        ?.getAttribute("data-nzv-id") || "";
    const shouldShowReference = !isEventIdentifier(identifier);

    return reference && shouldShowReference
      ? `<span class="sender-pubkey" data-pubkey="${pubkey}">${displayIdentifier}</span>`
      : `<span class="sender-pubkey" data-nip05-target="true" data-pubkey="${pubkey}">${displayIdentifier}</span>`;
  }

  static createReferenceComponent({ reference }, viewId) {
    if (!reference) return "";

    try {
      const getLinkUrl = this.getReferenceUrl(reference);
      const content = this.getReferenceContent(reference);

      return `
        <div class="zap-reference">
          <div class="reference-icon">
            <img src="${arrowRightIcon}" alt="Reference" width="16" height="16" />
          </div>
          <div class="reference-content">
            <div class="reference-text">${escapeHTML(content)}</div>
            <a href="${getLinkUrl}" target="_blank" class="reference-link">
              <img src="${quickReferenceIcon}" alt="Quick Reference" width="16" height="16" />
            </a>
          </div>
        </div>
      `;
    } catch (error) {
      console.error("Failed to create reference component:", error);
      return "";
    }
  }

  static getReferenceUrl(reference) {
    if (reference.kind === 31990) {
      const rTags = reference.tags.filter((t) => t[0] === "r");
      const nonSourceTag = rTags.find((t) => !t.includes("source")) || rTags[0];
      return nonSourceTag?.[1];
    }
    return `https://njump.me/${encodeNevent(
      reference.id,
      reference.kind,
      reference.pubkey
    )}`;
  }

  static getReferenceContent(reference) {
    const kindContentMap = {
      30023: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30030: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30009: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      40: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      41: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      31990: () => reference.tags.find((t) => t[0] === "alt")?.[1] || reference.content,
    };

    return kindContentMap[reference.kind]?.() || reference.content;
  }
}