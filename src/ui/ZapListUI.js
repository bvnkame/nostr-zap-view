import { ZapInfo } from "../ZapInfo.js";
import { DialogComponents } from "../DialogComponents.js";
import { createNoZapsMessage } from "../utils.js";
import { DIALOG_CONFIG } from "../AppSettings.js";
import defaultIcon from "../assets/nostr-icon.svg";
import { cacheManager } from "../CacheManager.js";

class ZapItemBuilder {
  constructor(viewId, config) {
    this.viewId = viewId;
    this.config = config;
  }

  async createListItem(event) {
    const zapInfo = await ZapInfo.createFromEvent(event, defaultIcon, {
      isColorModeEnabled: this.config?.isColorModeEnabled
    });


    const li = document.createElement("li");
    
    li.className = `zap-list-item ${zapInfo.colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.setAttribute("data-pubkey", zapInfo.pubkey);
    if (event?.id) li.setAttribute("data-event-id", event.id);

    li.innerHTML = DialogComponents.createZapItemHTML(zapInfo, zapInfo.colorClass, this.viewId);

    return { li, zapInfo };
  }
}

export class ZapListUI {
  constructor(shadowRoot, profileUI, viewId, config) {
    if (!shadowRoot) throw new Error('shadowRoot is required');
    if (!config) throw new Error('config is required');
    
    this.shadowRoot = shadowRoot;
    this.profileUI = profileUI;
    this.viewId = viewId;
    this.config = config;
    
    this.itemBuilder = new ZapItemBuilder(viewId, this.config);
    this.profileUpdateUnsubscribe = null;
    this.#initializeProfileUpdates();
  }

  // プロフィール更新の購読を簡略化
  #initializeProfileUpdates() {
    this.profileUpdateUnsubscribe = cacheManager.subscribeToProfileUpdates(
      this.#handleProfileUpdate.bind(this)
    );
  }

  async #handleProfileUpdate(pubkey, profile) {
    const elements = this.shadowRoot.querySelectorAll(`[data-pubkey="${pubkey}"]`);
    await Promise.allSettled(
      Array.from(elements).map(element => 
        this.profileUI.updateProfileElement(element, profile)
      )
    );
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
    if (!list) return;

    // キャッシュが存在しないか空の場合はNoZapsMessageを表示
    if (!zapEventsCache?.length) {
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
          DialogComponents.addReferenceToElement(li, cachedReference);
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

  async showNoZapsMessage() {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    // 3秒待機
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 遅延後に再度キャッシュを確認
    const zapEvents = cacheManager.getZapEvents(this.viewId);
    if (zapEvents?.length) {
      // Zapイベントが見つかった場合は表示
      await this.renderZapListFromCache(zapEvents);
      return;
    }

    // Zapイベントが見つからない場合はメッセージを表示
    list.innerHTML = `
      <div class="no-zaps-container">
        ${createNoZapsMessage(DIALOG_CONFIG)}
      </div>
    `;
    list.style.minHeight = '100px';
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
    const PROFILE_BATCH_SIZE = 10;
    for (let i = 0; i < profileUpdates.length; i += PROFILE_BATCH_SIZE) {
      const batch = profileUpdates.slice(i, i + PROFILE_BATCH_SIZE);
      await Promise.all(
        batch.map(({ pubkey, element }) => 
          this.#updateProfileIfNeeded(pubkey, element)
        )
      );
      // UIの更新を待つ
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
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

  updateZapReference(event) {
    const zapElement = this.getElementByEventId(event.id);
    if (!zapElement || !event.reference) return;

    DialogComponents.addReferenceToElement(zapElement, event.reference);
    cacheManager.setReference(event.id, event.reference);
  }

  async batchUpdate(events) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const existingTrigger = list.querySelector('.load-more-trigger');
      const existingItems = new Map(
        Array.from(list.querySelectorAll('.zap-list-item'))
          .map(item => [item.getAttribute('data-event-id'), item])
      );

      // 1. まず全てのイ��ントを表示する
      const fragment = document.createDocumentFragment();
      const updateQueue = [];

      for (const event of events) {
        // 既存のアイテムを再利用
        const existingItem = existingItems.get(event.id);
        if (existingItem) {
          fragment.appendChild(existingItem);
          existingItems.delete(event.id);
          if (event.reference) {
            updateQueue.push(() => this.updateZapReference(event));
          }
          continue;
        }

        // 新しいアイテムを作成
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        fragment.appendChild(li);
        
        // 後で実行する更新をキューに追加
        if (event.reference) {
          updateQueue.push(() => this.updateZapReference(event));
        }
        if (zapInfo.pubkey) {
          updateQueue.push(() => this.#updateProfileIfNeeded(zapInfo.pubkey, li));
        }
      }

      // UIを即座に更新
      list.innerHTML = '';
      list.appendChild(fragment);
      if (existingTrigger) list.appendChild(existingTrigger);

      // 2. バックグラウンドで更新を実行
      requestIdleCallback(() => {
        const BATCH_SIZE = 10;
        const processBatch = async (startIndex) => {
          const batch = updateQueue.slice(startIndex, startIndex + BATCH_SIZE);
          if (batch.length === 0) return;

          await Promise.all(batch.map(update => update()));
          await new Promise(resolve => requestAnimationFrame(resolve));
          await processBatch(startIndex + BATCH_SIZE);
        };

        processBatch(0).catch(console.error);
      });

    } catch (error) {
      console.error("Failed to batch update:", error);
    }
  }

}