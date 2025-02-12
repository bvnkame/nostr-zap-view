import { escapeHTML, isEventIdentifier, encodeNevent, encodeNaddr, isWithin24Hours,
         formatIdentifier, parseZapEvent, encodeNpub, createDefaultZapInfo } from "./utils.js";
import { cacheManager } from "./CacheManager.js";
import { APP_CONFIG } from "./AppSettings.js";
import arrowRightIcon from "./assets/arrow_right.svg";
import quickReferenceIcon from "./assets/link.svg";

export class DialogComponents {
  // 定数定義
  static #REFERENCE_KIND_MAPPING = {
    1: 'content',
    30023: 'title',
    30030: 'title',
    30009: 'name',
    40: 'content',
    42: 'name',
    31990: 'alt'
  };

  static #ERROR_MESSAGES = {
    UI_COMPONENTS: 'Failed to create UI components:',
    ZAP_ITEM: 'Failed to create zap item HTML:',
    REFERENCE: 'Reference component creation failed:'
  };

  // Core UI Component Methods
  static createUIComponents(zapInfo, viewId, identifier) {
    try {
      // identifierの取得をViewConfigから行う
      const config = this.viewConfigs?.get(viewId);
      const currentIdentifier = identifier || config?.identifier;
      
      // identifierがeventの場合はreferenceを無視
      const normalizedReference = isEventIdentifier(currentIdentifier) ? null : this.#getNormalizedReference(zapInfo);
      
      return {
        iconComponent: this.#createIconComponent(),
        nameComponent: this.#createNameComponent(zapInfo),
        pubkeyComponent: this.#createPubkeyComponent(zapInfo, currentIdentifier),
        referenceComponent: this.#createReferenceComponent(normalizedReference),
      };
    } catch (error) {
      console.error(this.#ERROR_MESSAGES.UI_COMPONENTS, error);
      return this.#createDefaultComponents();
    }
  }

  static #createIconComponent() {
    return '<div class="zap-placeholder-icon skeleton"></div>';
  }

  static #createDefaultComponents() {
    return {
      iconComponent: '<div class="zap-placeholder-icon skeleton"></div>',
      nameComponent: '<div class="zap-placeholder-name skeleton"></div>',
      pubkeyComponent: '',
      referenceComponent: '',
    };
  }

  // Reference Handling Methods
  static createReferenceComponent(reference) {
    return this.#createReferenceComponent(this.#getNormalizedReference({ reference }));
  }

  static addReferenceToElement(element, reference) {
    if (!this.#validateReferenceElement(element, reference)) return;

    const zapContent = element.querySelector('.zap-content');
    this.#updateReferenceContent(zapContent, reference);
  }

  static #validateReferenceElement(element, reference) {
    return element && reference && element.querySelector('.zap-content');
  }

  static #updateReferenceContent(zapContent, reference) {
    zapContent.querySelectorAll('.zap-reference').forEach(ref => ref.remove());
    const referenceHTML = this.createReferenceComponent({ reference });
    zapContent.insertAdjacentHTML('beforeend', referenceHTML);
  }

  // Template Generation Methods
  static getDialogTemplate() {
    return `
      <dialog class="dialog">
        <h2 class="dialog-title"><a href="#" target="_blank"></a></h2>
        <button class="close-dialog-button">X</button>
        <div class="zap-stats"></div>
        <ul class="dialog-zap-list"></ul>
      </dialog>
    `;
  }

  static createZapItemHTML(zapInfo, colorClass, viewId, identifier) {
    try {
      const components = this.createUIComponents(zapInfo, viewId, identifier);
      return this.#buildZapItemTemplate(zapInfo, colorClass, components);
    } catch (error) {
      console.error(this.#ERROR_MESSAGES.ZAP_ITEM, error);
      return '';
    }
  }

  static createNoZapsMessageHTML(message) {
    return `
      <div class="no-zaps-container">
        <div class="no-zaps-message">${message}</div>
      </div>
    `;
  }

  // Private Helper Methods
  static #buildZapItemTemplate(zapInfo, colorClass, components) {
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

  // Reference Processing Methods
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
    if (!this.#isValidReference(reference)) return "";

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
      console.error(this.#ERROR_MESSAGES.REFERENCE, error);
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
    if (!reference) return '';

    const tagKey = DialogComponents.#REFERENCE_KIND_MAPPING[reference.kind];

    if (tagKey) {
      const tag = reference.tags.find(t => Array.isArray(t) && t[0] === tagKey);
      if (tag && tag[1]) {
        return tag[1];
      }
    }

    // kind 40 の特別な処理
    if (reference.kind === 40) {
      try {
        const contentObj = JSON.parse(reference.content);
        return contentObj.name || reference.content;
      } catch {
        // JSON パースに失敗した場合はそのまま content を返す
      }
    }

    // タグから取得できなかった場合、content を返す
    return reference.content || '';
  }

  static #buildReferenceHTML(url, content) {
    return `
      <div class="zap-reference">
        <div class="reference-arrow">
          <img src="${arrowRightIcon}" alt="Reference" width="18" height="18" />
        </div>
        <div class="reference-text">${escapeHTML(content)}</div>
        <a href="${url}" target="_blank" class="reference-link">
          <img src="${quickReferenceIcon}" alt="Quick Reference" width="16" height="16" />
        </a>
      </div>
    `;
  }

  // ZapInfo Integration
  static ZapInfo = class {
    #event;
    
    constructor(event) {
      this.#event = event;
    }

    static async createFromEvent(event, config = {}) {
      const zapInfo = new DialogComponents.ZapInfo(event);
      return await zapInfo.extractInfo(config);
    }

    static getAmountColorClass(amount, isColorModeEnabled) {
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
      const eventId = this.#event.id;
      const cachedInfo = cacheManager.getZapInfo(eventId);
      if (cachedInfo) {
        cachedInfo.colorClass = DialogComponents.ZapInfo.getAmountColorClass(
          cachedInfo.satsAmount,
          config.isColorModeEnabled
        );
        return cachedInfo;
      }

      try {
        const { pubkey, content, satsText } = await parseZapEvent(this.#event);
        const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
        const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

        const reference = this.#event.reference || null;
        
        const info = {
          satsText,
          satsAmount,
          comment: content || "",
          pubkey: normalizedPubkey || "",
          created_at: this.#event.created_at,
          displayIdentifier: normalizedPubkey
            ? formatIdentifier(encodeNpub(normalizedPubkey))
            : "anonymous",
          senderName: null,
          senderIcon: null,
          reference,
          colorClass: DialogComponents.ZapInfo.getAmountColorClass(
            satsAmount, 
            config?.isColorModeEnabled
          )
        };

        cacheManager.setZapInfo(eventId, info);
        return info;

      } catch (error) {
        console.error("Failed to extract zap info:", error, this.#event);
        const defaultInfo = createDefaultZapInfo(this.#event);
        cacheManager.setZapInfo(eventId, defaultInfo);
        return defaultInfo;
      }
    }

    static async batchExtractInfo(events, isColorModeEnabled = true) {
      const results = new Map();
      await Promise.all(
        events.map(async event => {
          const zapInfo = new DialogComponents.ZapInfo(event);
          const info = await zapInfo.extractInfo({ isColorModeEnabled });
          results.set(event.id, info);
        })
      );
      return results;
    }
  }

  // ViewConfigsの保持用
  static viewConfigs = new Map();
}