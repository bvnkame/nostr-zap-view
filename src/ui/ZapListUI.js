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
  // 1. 基本構造
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

  destroy() {
    if (this.profileUpdateUnsubscribe) {
      this.profileUpdateUnsubscribe();
      this.profileUpdateUnsubscribe = null;
    }
  }

  // 2. リスト操作の基本メソッド
  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  getElementByEventId(eventId) {
    return this.#getElement(`.zap-list-item[data-event-id="${eventId}"]`);
  }

  async #updateListContent(operation) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      this.#removeNoZapsMessage(list);
      const result = await operation(list);
      return result;
    } catch (error) {
      console.error("List operation failed:", error);
      if (list.children.length === 0) {
        this.showNoZapsMessage();
      }
    }
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

  // 3. Zap要素の操作メソッド
  async #createAndAddZapElement(event, insertFn) {
    return this.#updateListContent(async (list) => {
      const { li, zapInfo } = await this.itemBuilder.createListItem(event);
      insertFn(list, li);
      await this.#updateProfileIfNeeded(zapInfo.pubkey, li);
      return { li, zapInfo };
    });
  }

  async renderZapListFromCache(zapEventsCache) {
    if (!zapEventsCache?.length) {
      return this.showNoZapsMessage();
    }

    await this.#updateListContent(async (list) => {
      const fragment = document.createDocumentFragment();
      const uniqueEvents = this.#getUniqueEvents(zapEventsCache);
      const profileUpdates = [];

      for (const event of uniqueEvents) {
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        this.#handleCachedReference(event.id, li);
        fragment.appendChild(li);
        if (zapInfo.pubkey) {
          profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
        }
      }

      this.#updateList(list, fragment);
      await this.#updateProfiles(profileUpdates);
    });
  }

  async prependZap(event) {
    return this.#createAndAddZapElement(event, (list, li) => list.prepend(li));
  }

  async appendZap(event) {
    return this.#createAndAddZapElement(event, (list, li) => {
      const position = this.findInsertPosition(list, event.created_at);
      position ? list.insertBefore(li, position) : list.appendChild(li);
    });
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

    const delay = this.config.noZapsDelay || 3000;
    await this.#delayAndCheckCache(delay);

    // キャッシュを再確認
    const zapEvents = cacheManager.getZapEvents(this.viewId);
    if (zapEvents?.length) {
      await this.renderZapListFromCache(zapEvents);
      return;
    }

    // カスタマイズ可能なNoZapsメッセージを表示
    this.#displayNoZapsMessage(list);
  }

  async #delayAndCheckCache(delay) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  #displayNoZapsMessage(list) {
    const customMessage = this.config.noZapsMessage || DIALOG_CONFIG.NO_ZAPS_MESSAGE;
    list.innerHTML = `
      <div class="no-zaps-container">
        ${createNoZapsMessage({ NO_ZAPS_MESSAGE: customMessage })}
      </div>
    `;
    list.style.minHeight = '100px';
  }

  // バッチ更新関連
  async batchUpdate(events) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const existingTrigger = list.querySelector('.load-more-trigger');
      const existingItems = new Map(
        Array.from(list.querySelectorAll('.zap-list-item'))
          .map(item => [item.getAttribute('data-event-id'), item])
      );

      // 1. まず全てのイベントを表示する
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

  updateZapReference(event) {
    if (!event?.id || !event?.reference) return;

    try {
      const zapElement = this.getElementByEventId(event.id);
      if (!zapElement) return;

      DialogComponents.addReferenceToElement(zapElement, event.reference);
      cacheManager.setReference(event.id, event.reference);
    } catch (error) {
      console.error("Failed to update zap reference:", error);
    }
  }

  // 4. プロフィール関連メソッド
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

  // 5. ヘルパーメソッド
  #getUniqueEvents(events) {
    return [...new Map(events.map(e => [e.id, e])).values()]
      .sort((a, b) => b.created_at - a.created_at);
  }

  #handleCachedReference(eventId, element) {
    const cachedReference = cacheManager.getReference(eventId);
    if (cachedReference) {
      DialogComponents.addReferenceToElement(element, cachedReference);
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
}