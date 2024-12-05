import { escapeHTML, isEventIdentifier, encodeNevent, encodeNaddr, isWithin24Hours } from "./utils.js";
import arrowRightIcon from "./assets/arrow_right.svg";
import quickReferenceIcon from "./assets/link.svg";
import { cacheManager } from "./CacheManager.js";

// 定数定義
const REFERENCE_KIND_MAPPING = {
  1: 'content',
  30023: 'title',
  30030: 'title',
  30009: 'name',
  40: 'content',
  42: 'name',
  31990: 'alt'
};

export class DialogComponents {
  // Public APIs
  static createUIComponents(zapInfo, _viewId, identifier) {

    const normalizedReference = this.#getNormalizedReference(zapInfo);
    
    return {
      iconComponent: '<div class="zap-placeholder-icon skeleton"></div>',
      nameComponent: this.#createNameComponent(zapInfo),
      pubkeyComponent: this.#createPubkeyComponent(zapInfo, identifier),
      referenceComponent: this.#createReferenceComponent(normalizedReference),
    };
  }

  // 外部から呼び出し可能なパブリックメソッドとして追加
  static createReferenceComponent(reference) {
    const normalizedRef = this.#getNormalizedReference({ reference });
    return this.#createReferenceComponent(normalizedRef);
  }

  // 新しいメソッドを追加
  static addReferenceToElement(element, reference) {
    if (!element || !reference) return;

    const zapContent = element.querySelector('.zap-content');
    if (!zapContent) return;

    // 既存の参照を削除
    const existingReferences = zapContent.querySelectorAll('.zap-reference');
    existingReferences.forEach(ref => ref.remove());

    // 新しい参照を追加
    const referenceHTML = this.createReferenceComponent({ reference });
    zapContent.insertAdjacentHTML('beforeend', referenceHTML);
  }

  // Private methods
  static #getNormalizedReference(zapInfo) {
    if (!zapInfo) return null;

    // zapInfo自体がreferenceとして有効な場合
    if (this.#isValidReference(zapInfo)) {
      return zapInfo;
    }

    // zapInfo.referenceがオブジェクトとして存在する場合
    if (zapInfo.reference && typeof zapInfo.reference === 'object') {
      // reference.referenceをチェック
      if (zapInfo.reference.reference && this.#isValidReference(zapInfo.reference.reference)) {
        return zapInfo.reference.reference;
      }
      // reference自体をチェック
      if (this.#isValidReference(zapInfo.reference)) {
        return zapInfo.reference;
      }
    }

    return null;
  }

  static #isValidReference(obj) {
    return obj && 
           typeof obj === 'object' &&
           'id' in obj &&
           'tags' in obj &&
           Array.isArray(obj.tags) &&
           'content' in obj &&
           'kind' in obj;
  }

  static #createNameComponent({ senderName }) {
    return senderName
      ? `<span class="sender-name">${escapeHTML(senderName)}</span>`
      : '<div class="zap-placeholder-name skeleton"></div>';
  }

  static #createPubkeyComponent({ pubkey, displayIdentifier, reference }, identifier) {
    const shouldShowReference = !isEventIdentifier(identifier);
    const commonAttrs = `class="sender-pubkey" data-pubkey="${pubkey}"`;
    
    return reference && shouldShowReference
      ? `<span ${commonAttrs}>${displayIdentifier}</span>`
      : `<span ${commonAttrs} data-nip05-target="true">${displayIdentifier}</span>`;
  }

  static #createReferenceComponent(reference) {
    if (!reference || !this.#isValidReference(reference)) {
      return "";
    }

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
    // 引数の検証
    if (!reference?.tags) return '';

    if (reference.kind === 31990) {
      return this.#extractRTagUrl(reference) || '';
    }

    // d-tagのチェック
    const dTag = Array.isArray(reference.tags) ? 
      reference.tags.find(t => Array.isArray(t) && t[0] === 'd') : null;

    if (dTag) {
      return `https://njump.me/${encodeNaddr(
        reference.kind,
        reference.pubkey,
        dTag[1]
      )}`;
    }

    return reference.id ? `https://njump.me/${encodeNevent(
      reference.id,
      reference.kind,
      reference.pubkey
    )}` : '';
  }

  static #extractRTagUrl(reference) {
    const rTags = reference.tags.filter(t => t[0] === "r");
    const nonSourceTag = rTags.find(t => !t.includes("source")) || rTags[0];
    return nonSourceTag?.[1];
  }

  static #getReferenceContent(reference) {
    if (!reference?.tags || !reference?.content) return '';

    const tagKey = REFERENCE_KIND_MAPPING[reference.kind];
    if (!tagKey) return reference.content;

    if (reference.kind === 40) {
      try {
        const contentObj = JSON.parse(reference.content);
        return contentObj.name || reference.content;
      } catch {
        return reference.content;
      }
    }

    if (tagKey === 'content') return reference.content;

    const tag = Array.isArray(reference.tags) ?
      reference.tags.find(t => Array.isArray(t) && t[0] === tagKey) : null;
    return tag?.[1] || reference.content;
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

  static createZapItemHTML(zapInfo, colorClass, viewId, identifier) {
    const components = this.createUIComponents(zapInfo, viewId, identifier);
    const [amount, unit] = zapInfo.satsText.split(" ");
    const isNew = isWithin24Hours(zapInfo.created_at);

    return `
      <div class="zap-content">
        <div class="zap-sender${zapInfo.comment ? " with-comment" : ""}" data-pubkey="${zapInfo.pubkey}">
          <div class="sender-icon${isNew ? " is-new" : ""}">
            ${components.iconComponent}
          </div>
          <div class="sender-info">
            ${components.nameComponent}
            ${components.pubkeyComponent}
          </div>
          <div class="zap-amount ${colorClass}"><span class="number">${amount}</span> ${unit}</div>
        </div>
        ${zapInfo.comment ? `<div class="zap-details"><span class="zap-comment">${escapeHTML(zapInfo.comment)}</span></div>` : ""}
        ${components.referenceComponent}
      </div>
    `;
  }
}