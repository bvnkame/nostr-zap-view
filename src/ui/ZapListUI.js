import { ZapInfo } from "../ZapInfo.js";
import { DialogComponents } from "../DialogComponents.js";
import { ProfileUI } from "./ProfileUI.js";
import { 
  createNoZapsMessage,
  isColorModeEnabled 
} from "../utils.js";
import { APP_CONFIG } from "../AppSettings.js";
import defaultIcon from "../assets/nostr-icon.svg";
import { cacheManager } from "../CacheManager.js";

class ZapItemBuilder {
  constructor(viewId, isColorModeEnabled) {
    this.viewId = viewId;
    this.isColorModeEnabled = isColorModeEnabled;
  }

  async createListItem(event) {
    const zapInfo = await ZapInfo.createFromEvent(event, defaultIcon);
    const li = document.createElement("li");
    
    li.className = `zap-list-item ${zapInfo.colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.setAttribute("data-pubkey", zapInfo.pubkey);
    if (event?.id) li.setAttribute("data-event-id", event.id);

    li.innerHTML = DialogComponents.createZapItemHTML(zapInfo, zapInfo.colorClass, this.viewId);

    return { li, zapInfo };
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
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        
        // キャッシュされたreferenceがあれば表示
        const cachedReference = cacheManager.getReference(event.id);
        if (cachedReference) {
          const zapContent = li.querySelector('.zap-content');
          if (zapContent) {
            const referenceHTML = DialogComponents.createReferenceComponent({ 
              reference: cachedReference 
            });
            zapContent.insertAdjacentHTML('beforeend', referenceHTML);
          }
        }

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
      const { li, zapInfo } = await this.itemBuilder.createListItem(event);
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
      const { li, zapInfo } = await this.itemBuilder.createListItem(event);
      
      // 適切な挿入位置を探す
      const position = this.#findInsertPosition(list, event.created_at);
      if (position) {
        list.insertBefore(li, position);
      } else {
        list.appendChild(li);
      }
      
      await this.#updateProfileIfNeeded(zapInfo.pubkey, li);
    } catch (error) {
      console.error("Failed to append zap:", error);
    }
  }

  #findInsertPosition(list, timestamp) {
    const items = list.querySelectorAll('.zap-list-item');
    for (const item of items) {
      const event = item.getAttribute('data-event');
      if (event) {
        const itemTime = JSON.parse(event).created_at;
        if (timestamp > itemTime) {
          return item;
        }
      }
    }
    return null;
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!this.#isValidPlaceholder(placeholder)) return;

    try {
      const { zapInfo } = await this.itemBuilder.createListItem(event);
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
    const zapElement = this.getElementByEventId(event.id);
    if (!zapElement || !event.reference) return;

    const zapContent = zapElement.querySelector('.zap-content');
    if (!zapContent) return;

    // 既存の参照情報を確実に削除
    this.#cleanupExistingReferences(zapContent);

    // 新しい参照情報を追加
    const referenceHTML = DialogComponents.createReferenceComponent({ 
      reference: event.reference 
    });
    zapContent.insertAdjacentHTML('beforeend', referenceHTML);

    // 参照情報をキャッシュに保存
    cacheManager.setReference(event.id, event.reference);
  }

  #cleanupExistingReferences(container) {
    const existingReferences = container.querySelectorAll('.zap-reference');
    existingReferences.forEach(ref => ref.remove());
  }

  async batchUpdate(events) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const existingItems = new Map(
        Array.from(list.querySelectorAll('.zap-list-item'))
          .map(item => [item.getAttribute('data-event-id'), item])
      );

      const fragment = document.createDocumentFragment();
      const profileUpdates = [];

      for (const event of events) {
        // 既存のアイテムがあれば再利用
        const existingItem = existingItems.get(event.id);
        if (existingItem) {
          // 既存のアイテムの参照情報をクリーンアップ
          const zapContent = existingItem.querySelector('.zap-content');
          if (zapContent) {
            this.#cleanupExistingReferences(zapContent);
            if (event.reference) {
              const referenceHTML = DialogComponents.createReferenceComponent({ 
                reference: event.reference 
              });
              zapContent.insertAdjacentHTML('beforeend', referenceHTML);
            }
          }
          fragment.appendChild(existingItem);
          existingItems.delete(event.id);
          continue;
        }

        // 新しいアイテムを作成
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        
        if (event.reference) {
          const zapContent = li.querySelector('.zap-content');
          if (zapContent) {
            const referenceHTML = DialogComponents.createReferenceComponent({ 
              reference: event.reference 
            });
            zapContent.insertAdjacentHTML('beforeend', referenceHTML);
          }
        }

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