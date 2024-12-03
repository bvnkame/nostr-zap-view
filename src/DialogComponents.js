import { 
  escapeHTML, 
  isEventIdentifier, 
  encodeNevent,
  isWithin24Hours 
} from "./utils.js";
import arrowRightIcon from "./assets/arrow_right.svg";
import quickReferenceIcon from "./assets/link.svg";
import { cacheManager } from "./CacheManager.js";

// 定数定義
const REFERENCE_KIND_MAPPING = {
  1: 'content',
  30023: 'title',
  30030: 'title',
  30009: 'name',
  40: 'name',
  41: 'name',
  31990: 'alt'
};

export class DialogComponents {
  // UI Components
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

  // Reference Handling
  static createReferenceComponent({ reference }) {
    if (!reference) return "";
    
    const cacheKey = reference.id;
    const cachedComponent = cacheManager.getReferenceComponent(cacheKey);
    if (cachedComponent) return cachedComponent;

    try {
      const url = this.#getReferenceUrl(reference);
      const content = this.#getReferenceContent(reference);
      const html = this.#buildReferenceHTML(url, content);
      
      cacheManager.setReferenceComponent(cacheKey, html);
      return html;
    } catch (error) {
      console.error("Reference component creation failed:", error);
      return "";
    }
  }

  static #getReferenceUrl(reference) {
    if (reference.kind === 31990) {
      return this.#extractRTagUrl(reference) || '';
    }
    return this.#createNeventUrl(reference);
  }

  static #extractRTagUrl(reference) {
    const rTags = reference.tags.filter(t => t[0] === "r");
    const nonSourceTag = rTags.find(t => !t.includes("source")) || rTags[0];
    return nonSourceTag?.[1];
  }

  static #createNeventUrl(reference) {
    return `https://njump.me/${encodeNevent(
      reference.id,
      reference.kind,
      reference.pubkey
    )}`;
  }

  static #getReferenceContent(reference) {
    const tagKey = REFERENCE_KIND_MAPPING[reference.kind];
    if (!tagKey) return reference.content;

    if (tagKey === 'content') return reference.content;
    return reference.tags.find(t => t[0] === tagKey)?.[1] || reference.content;
  }

  static #buildReferenceHTML(url, content) {
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