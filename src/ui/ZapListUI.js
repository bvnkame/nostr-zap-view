import { ZapInfo } from "../ZapInfo.js";
import { DialogComponents } from "../DialogComponents.js";
import { ProfileUI } from "./ProfileUI.js";
import { 
  isWithin24Hours, 
  getAmountColorClass, 
  escapeHTML, 
  createNoZapsMessage,
  isColorModeEnabled  // 追加
} from "../utils.js";
import { APP_CONFIG, ZAP_AMOUNT_CONFIG } from "../AppSettings.js";
import defaultIcon from "../assets/nostr-icon.svg";

export class ZapListUI {
  constructor(shadowRoot, profileUI, viewId) {  // viewIdを追加
    this.shadowRoot = shadowRoot;
    this.profileUI = profileUI || new ProfileUI();
    this.viewId = viewId;  // viewIdを保存
  }

  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  async renderZapListFromCache(zapEventsCache) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list || !zapEventsCache?.length) {
      this.showNoZapsMessage();
      return;
    }

    const existingTrigger = list.querySelector('.load-more-trigger');
    const existingEvents = this.#getExistingEvents(list);
    const uniqueEvents = [...new Map(zapEventsCache.map(e => [e.id, e])).values()]
      .sort((a, b) => b.created_at - a.created_at);

    const fragment = document.createDocumentFragment();
    const profileUpdates = [];

    for (const event of uniqueEvents) {
      const existingEvent = existingEvents.get(event.id);
      if (existingEvent) {
        fragment.appendChild(existingEvent.element);
        continue;
      }

      const zapInfo = await this.#handleZapInfo(event);
      const li = this.#createListItem(zapInfo, event);
      fragment.appendChild(li);

      if (zapInfo.pubkey) {
        profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
      }
    }

    list.innerHTML = '';
    list.appendChild(fragment);
    if (existingTrigger) list.appendChild(existingTrigger);

    // Update profiles
    for (const { pubkey, element } of profileUpdates) {
      await this.#loadProfileAndUpdate(pubkey, element);
    }
  }

  async prependZap(event) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    // "No Zaps" メッセージが存在する場合、メッセージのみを削除
    const noZapsMessage = list.querySelector(".no-zaps-message");
    if (noZapsMessage) {
      noZapsMessage.remove();
    }

    try {
      const zapInfo = await this.#handleZapInfo(event);
      const li = this.#createListItem(zapInfo, event);
      list.prepend(li);

      // プロフィール情報を非同期で更新
      if (zapInfo.pubkey) {
        this.#loadProfileAndUpdate(zapInfo.pubkey, li).catch(console.error);
      }
    } catch (error) {
      console.error("Failed to prepend zap:", error);
    }
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!this.#isValidPlaceholder(placeholder)) return;

    try {
      const zapInfo = await this.#handleZapInfo(event);
      this.#updatePlaceholderContent(placeholder, zapInfo, event.id);
      await this.#updateProfileIfNeeded(zapInfo.pubkey, placeholder);
    } catch (error) {
      console.error("Failed to replace placeholder:", error);
      placeholder.remove();
    }
  }

  showNoZapsMessage() {
    const list = this.#getElement(".dialog-zap-list");
    if (list) {
      list.innerHTML = createNoZapsMessage(DIALOG_CONFIG);
    }
  }

  #createListItem(zapInfo, event) {
    const li = document.createElement("li");
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    
    li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.setAttribute("data-pubkey", zapInfo.pubkey);
    if (event?.id) li.setAttribute("data-event-id", event.id);
    li.innerHTML = this.#createZapHTML(zapInfo);

    return li;
  }

  async #handleZapInfo(event) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    return await zapInfo.extractInfo();
  }

  #getAmountColorClass(amount) {
    if (!this.#isColorModeEnabled()) return "";

    return getAmountColorClass(amount, ZAP_AMOUNT_CONFIG.THRESHOLDS);
  }

  #isColorModeEnabled() {
    const button = document.querySelector(
      `button[data-zap-view-id="${this.viewId}"]`
    );
    return isColorModeEnabled(button, APP_CONFIG.DEFAULT_OPTIONS.colorMode);
  }

  #createZapHTML(zapInfo) {
    const components = DialogComponents.createUIComponents(
      zapInfo,
      this.viewId  // this.getAttributeの代わりにthis.viewIdを使用
    );
    
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

  #isValidPlaceholder(element) {
    return element && element.classList.contains('placeholder');
  }

  #updatePlaceholderContent(placeholder, zapInfo, eventId) {
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    
    placeholder.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    placeholder.setAttribute("data-pubkey", zapInfo.pubkey);
    placeholder.setAttribute("data-event-id", eventId);
    placeholder.innerHTML = this.#createZapHTML(zapInfo);
    placeholder.removeAttribute('data-index');
  }

  async #updateProfileIfNeeded(pubkey, element) {
    if (pubkey) {
      await this.#loadProfileAndUpdate(pubkey, element);
    }
  }

  async #loadProfileAndUpdate(pubkey, element) {
    if (!pubkey || !element) return;
  
    try {
      await this.profileUI.loadAndUpdate(pubkey, element);
    } catch (error) {
      console.error("Failed to load profile:", error);
    }
  }

  #getExistingEvents(list) {
    return new Map(
      Array.from(list.children)
        .filter(li => li.hasAttribute('data-event-id'))
        .map(li => [li.getAttribute('data-event-id'), {
          element: li,
          html: li.innerHTML,
          classes: li.className
        }])
    );
  }
}