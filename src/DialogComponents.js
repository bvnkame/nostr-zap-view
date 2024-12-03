import { 
  escapeHTML, 
  isEventIdentifier, 
  encodeNevent,
  isWithin24Hours  // 追加
} from "./utils.js";
import arrowRightIcon from "./assets/arrow_right.svg";
import quickReferenceIcon from "./assets/link.svg";
import { cacheManager } from "./CacheManager.js";

export class DialogComponents {
  static createUIComponents(zapInfo, viewId) {
    return {
      iconComponent: this.#createIconComponent(),
      nameComponent: this.#createNameComponent(zapInfo),
      pubkeyComponent: this.createPubkeyComponent(zapInfo, viewId),
      referenceComponent: this.createReferenceComponent(zapInfo),
    };
  }

  static #createIconComponent() {
    return '<div class="zap-placeholder-icon skeleton"></div>';
  }

  static #createNameComponent({ senderName }) {
    return senderName
      ? `<span class="sender-name">${escapeHTML(senderName)}</span>`
      : '<div class="zap-placeholder-name skeleton"></div>';
  }

  static createPubkeyComponent({ pubkey, displayIdentifier, reference }, viewId) {
    const identifier = DialogComponents.getIdentifierFromButton(viewId);
    const shouldShowReference = !isEventIdentifier(identifier);
    const commonAttrs = `class="sender-pubkey" data-pubkey="${pubkey}"`;
    
    return reference && shouldShowReference
      ? `<span ${commonAttrs}>${displayIdentifier}</span>`
      : `<span ${commonAttrs} data-nip05-target="true">${displayIdentifier}</span>`;
  }

  static getIdentifierFromButton(viewId) {
    return document
      .querySelector(`button[data-zap-view-id="${viewId}"]`)
      ?.getAttribute("data-nzv-id") || "";
  }

  static createReferenceComponent({ reference }) {
    if (!reference) return "";

    const cacheKey = reference.id;
    const cachedComponent = cacheManager.getReferenceComponent(cacheKey);
    if (cachedComponent) {
      return cachedComponent;
    }

    try {
      console.log("Reference object:", reference);
      const url = DialogComponents.getReferenceUrl(reference);
      const content = DialogComponents.getReferenceContent(reference);
      
      const html = DialogComponents.createReferenceHTML(url, content);
      cacheManager.setReferenceComponent(cacheKey, html);
      return html;
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
      1: () => reference.content, // kind 1 の場合、contentをそのまま使用
      30023: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30030: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30009: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      40: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      41: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      31990: () => reference.tags.find((t) => t[0] === "alt")?.[1] || reference.content,
    };

    console.log("Reference kind:", reference.kind);
    console.log("Reference content map function:", kindContentMap[reference.kind]);

    return kindContentMap[reference.kind]?.() || reference.content;
  }

  static createReferenceHTML(url, content) {
    console.log("Creating reference HTML with URL:", url);
    console.log("Creating reference HTML with content:", content);
    return `
      <div class="zap-reference">
        <div class="reference-icon">
          <img src="${arrowRightIcon}" alt="Reference" width="16" height="16" />
        </div>
        <div class="reference-content">
          <div class="reference-text">${escapeHTML(content)}</div>
          <a href="${url}" target="_blank" class="reference-link">
            <img src="${quickReferenceIcon}" alt="Quick Reference" width="16" height="16" />
          </a>
        </div>
      </div>
    `;
  }

  static getDialogTemplate() {
    return `
      <dialog class="dialog">
        <h2 class="dialog-title"></h2>
        <button class="close-dialog-button">X</button>
        <div class="zap-stats"></div>
        <ul class="dialog-zap-list"></ul>
      </dialog>
    `;
  }

  static createZapItemHTML(zapInfo, colorClass, viewId) {
    const components = this.createUIComponents(zapInfo, viewId);
    const [amount, unit] = zapInfo.satsText.split(" ");
    const isNew = isWithin24Hours(zapInfo.created_at);

    return `
      <div class="zap-sender${zapInfo.comment ? " with-comment" : ""}" data-pubkey="${zapInfo.pubkey}">
        <div class="sender-icon${isNew ? " is-new" : ""}">
          ${components.iconComponent}
        </div>
        <div class="sender-info">
          ${components.nameComponent}
          ${components.pubkeyComponent}
        </div>
        <div class="zap-amount"><span class="number">${amount}</span> ${unit}</div>
      </div>
      ${zapInfo.comment ? `<div class="zap-details"><span class="zap-comment">${escapeHTML(zapInfo.comment)}</span></div>` : ""}
      ${components.referenceComponent}
    `;
  }
}