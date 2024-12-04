import { ZapInfo } from "../ZapInfo.js";
import { DialogComponents } from "../DialogComponents.js";
import { ProfileUI } from "./ProfileUI.js";
import { 
  getAmountColorClass, 
  createNoZapsMessage,
  isColorModeEnabled 
} from "../utils.js";
import { APP_CONFIG, ZAP_AMOUNT_CONFIG } from "../AppSettings.js";
import defaultIcon from "../assets/nostr-icon.svg";
import { cacheManager } from "../CacheManager.js";

class ZapItemBuilder {
  constructor(viewId, isColorModeEnabled) {
    this.viewId = viewId;
    this.isColorModeEnabled = isColorModeEnabled;
  }

  createListItem(zapInfo, event) {
    const li = document.createElement("li");
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    
    li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.setAttribute("data-pubkey", zapInfo.pubkey);
    if (event?.id) li.setAttribute("data-event-id", event.id);

    // 基本的なZap情報のコンテナを作成
    const zapContent = document.createElement('div');
    zapContent.className = 'zap-content';
    zapContent.innerHTML = DialogComponents.createZapItemHTML(zapInfo, colorClass, this.viewId);
    li.appendChild(zapContent);

    // 参照情報用のプレースホルダーを追加
    const referenceContainer = document.createElement('div');
    referenceContainer.className = 'reference-container';
    li.appendChild(referenceContainer);

    return li;
  }

  #getAmountColorClass(amount) {
    if (!this.isColorModeEnabled) return "";
    return getAmountColorClass(amount, ZAP_AMOUNT_CONFIG.THRESHOLDS);
  }
}

export class ZapListUI {
  constructor(shadowRoot, profileUI, viewId) {
    this.shadowRoot = shadowRoot;
    this.profileUI = profileUI || new ProfileUI();
    this.viewId = viewId;
    this.itemBuilder = new ZapItemBuilder(viewId, this.#isColorModeEnabled());
    this.profileUpdateUnsubscribe = null;
    this.#initializeProfileUpdates();
  }

  #initializeProfileUpdates() {
    this.profileUpdateUnsubscribe = cacheManager.subscribeToProfileUpdates(async (pubkey, profile) => {
      try {
        const elements = this.shadowRoot.querySelectorAll(`[data-pubkey="${pubkey}"]`);
        const updatePromises = Array.from(elements).map(element => 
          this.profileUI.updateProfileElement(element, profile)
        );
        await Promise.allSettled(updatePromises);
      } catch (error) {
        console.error('Profile update error:', error, { pubkey, profile });
      }
    });
  }

  destroy() {
    if (this.profileUpdateUnsubscribe) {
      this.profileUpdateUnsubscribe();
      this.profileUpdateUnsubscribe = null;
    }
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

    try {
      const fragment = document.createDocumentFragment();
      const uniqueEvents = this.#getUniqueEvents(zapEventsCache);
      const profileUpdates = [];

      for (const event of uniqueEvents) {
        const zapInfo = await this.#handleZapInfo(event);
        const li = this.itemBuilder.createListItem(zapInfo, event);
        fragment.appendChild(li);

        if (zapInfo.pubkey) {
          profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
        }
      }

      this.#updateList(list, fragment);
      await this.#updateProfiles(profileUpdates);
    } catch (error) {
      console.error("Failed to render zap list:", error);
      this.showNoZapsMessage();
    }
  }

  async prependZap(event) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      this.#removeNoZapsMessage(list);
      const zapInfo = await this.#handleZapInfo(event);
      const li = this.itemBuilder.createListItem(zapInfo, event);
      list.prepend(li);
      await this.#updateProfileIfNeeded(zapInfo.pubkey, li);
    } catch (error) {
      console.error("Failed to prepend zap:", error);
    }
  }

  getElementByEventId(eventId) {
    return this.#getElement(`.zap-list-item[data-event-id="${eventId}"]`);
  }

  async appendZap(event) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      this.#removeNoZapsMessage(list);
      const zapInfo = await this.#handleZapInfo(event);
      const li = this.itemBuilder.createListItem(zapInfo, event);
      list.appendChild(li);
      await this.#updateProfileIfNeeded(zapInfo.pubkey, li);
    } catch (error) {
      console.error("Failed to append zap:", error);
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

  #getUniqueEvents(events) {
    return [...new Map(events.map(e => [e.id, e])).values()]
      .sort((a, b) => b.created_at - a.created_at);
  }

  #updateList(list, fragment) {
    const existingTrigger = list.querySelector('.load-more-trigger');
    list.innerHTML = '';
    list.appendChild(fragment);
    if (existingTrigger) list.appendChild(existingTrigger);
  }

  #removeNoZapsMessage(list) {
    const noZapsMessage = list.querySelector(".no-zaps-message");
    if (noZapsMessage) noZapsMessage.remove();
  }

  async #updateProfiles(profileUpdates) {
    const updates = profileUpdates.map(({ pubkey, element }) => 
      this.#updateProfileIfNeeded(pubkey, element)
    );
    await Promise.allSettled(updates);
  }

  async #handleZapInfo(event) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    const extractedInfo = await zapInfo.extractInfo();
    cacheManager.updateZapCache(event, extractedInfo);
    return extractedInfo;
  }

  #isColorModeEnabled() {
    const button = document.querySelector(
      `button[data-zap-view-id="${this.viewId}"]`
    );
    return isColorModeEnabled(button, APP_CONFIG.DEFAULT_OPTIONS.colorMode);
  }

  #isValidPlaceholder(element) {
    return element && element.classList.contains('placeholder');
  }

  #updatePlaceholderContent(placeholder, zapInfo, eventId) {
    const colorClass = this.itemBuilder.getAmountColorClass(zapInfo.satsAmount);
    
    placeholder.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    placeholder.setAttribute("data-pubkey", zapInfo.pubkey);
    placeholder.setAttribute("data-event-id", eventId);
    placeholder.innerHTML = DialogComponents.createZapItemHTML(zapInfo, colorClass, this.viewId);
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
      // 即座にプロフィールを読み込んで表示
      await this.profileUI.loadAndUpdate(pubkey, element);
      // 更新は購読で処理されるため、ここでは初期表示のみ
    } catch (error) {
      console.error("Failed to load profile:", error);
    }
  }

  initializeZapPlaceholders(count) {  // メソッド名を統一
    // プレースホルダー初期化のロジック
  }

  updateZapReference(event) {
    const zapElement = this.#getElement(`[data-event-id="${event.id}"]`);
    if (!zapElement || !event.reference) return;

    const referenceContainer = zapElement.querySelector('.reference-container');
    if (referenceContainer) {
      referenceContainer.innerHTML = DialogComponents.createReferenceComponent({ reference: event.reference });
    }
  }

  async batchUpdate(events) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const fragment = document.createDocumentFragment();
      const profileUpdates = [];

      for (const event of events) {
        const zapInfo = await this.#handleZapInfo(event);
        const li = this.itemBuilder.createListItem(zapInfo, event);
        fragment.appendChild(li);

        if (zapInfo.pubkey) {
          profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
        }
      }

      // 既存のトリガーを保持
      const existingTrigger = list.querySelector('.load-more-trigger');
      list.innerHTML = '';
      list.appendChild(fragment);
      if (existingTrigger) list.appendChild(existingTrigger);

      // プロフィール情報を更新
      await this.#updateProfiles(profileUpdates);
    } catch (error) {
      console.error("Failed to batch update:", error);
    }
  }
}