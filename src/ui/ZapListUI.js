import { DialogComponents } from "../DialogComponents.js";
import { APP_CONFIG } from "../AppSettings.js";
import defaultIcon from "../assets/nostr-icon.svg";
import { cacheManager } from "../CacheManager.js";

class ZapItemBuilder {
  constructor(viewId, config) {
    this.viewId = viewId;
    this.config = config;
  }

  async createListItem(event) {
    const zapInfo = await DialogComponents.ZapInfo.createFromEvent(event, defaultIcon, {
      isColorModeEnabled: this.config?.isColorModeEnabled
    });


    const li = document.createElement("li");
    
    li.className = `zap-list-item ${zapInfo.colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.setAttribute("data-pubkey", zapInfo.pubkey);
    if (event?.id) li.setAttribute("data-event-id", event.id);

    li.innerHTML = DialogComponents.createZapItemHTML(zapInfo, zapInfo.colorClass, this.viewId);

    li.setAttribute('data-timestamp', event.created_at.toString());

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
      // キャッシュ状態をリセット
      cacheManager.setNoZapsState(this.viewId, false);
      return this.showNoZapsMessage();
    }

    await this.#updateListContent(async (list) => {
      // イベントの前処理を非同期で実行
      const uniqueEvents = this.#getUniqueEvents(zapEventsCache);
      const listFragment = document.createDocumentFragment();
      const profileUpdatesQueue = [];

      // 最初のバッチを即座に処理
      const INITIAL_BATCH = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.INITIAL_BATCH;
      const initialEvents = uniqueEvents.slice(0, INITIAL_BATCH);
      const remainingEvents = uniqueEvents.slice(INITIAL_BATCH);

      // 最初のバッチを同期的に処理
      for (const event of initialEvents) {
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        this.#handleCachedReference(event.id, li);
        listFragment.appendChild(li);
        if (zapInfo.pubkey) {
          profileUpdatesQueue.push({ pubkey: zapInfo.pubkey, element: li });
        }
      }

      // 最初のバッチをDOMに追加
      this.#updateList(list, listFragment);

      // 残りのイベントを非同期で処理
      if (remainingEvents.length > 0) {
        requestIdleCallback(async () => {
          const batchSize = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.REMAINING_BATCH;
          for (let i = 0; i < remainingEvents.length; i += batchSize) {
            const batch = remainingEvents.slice(i, i + batchSize);
            const batchFragment = document.createDocumentFragment();

            await Promise.all(batch.map(async (event) => {
              const { li, zapInfo } = await this.itemBuilder.createListItem(event);
              this.#handleCachedReference(event.id, li);
              batchFragment.appendChild(li);
              if (zapInfo.pubkey) {
                profileUpdatesQueue.push({ pubkey: zapInfo.pubkey, element: li });
              }
            }));

            // バッチをDOMに追加
            const existingTrigger = list.querySelector('.load-more-trigger');
            if (existingTrigger) {
              list.insertBefore(batchFragment, existingTrigger);
            } else {
              list.appendChild(batchFragment);
            }

            // UIの更新を待つ
            await new Promise(resolve => requestAnimationFrame(resolve));
          }

          // プロフィール更新を開始
          this.#updateProfiles(profileUpdatesQueue);
        });
      } else {
        // 初期バッチのプロフィール更新を実行
        this.#updateProfiles(profileUpdatesQueue);
      }
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

    // キャッシュされたNO_ZAPS状態をチェック
    if (cacheManager.hasNoZaps(this.viewId)) {
      this.#displayNoZapsMessage(list);
      return;
    }

    // キャッシュを遅延チェック
    const hasZaps = await this.#checkCacheWithDelay();
    if (hasZaps) return;

    // NoZapsメッセージを表示し、状態をキャッシュ
    this.#displayNoZapsMessage(list);
    cacheManager.setNoZapsState(this.viewId, true);
  }

  async #checkCacheWithDelay() {
    const delay = this.config.noZapsDelay || APP_CONFIG.DIALOG_CONFIG.DEFAULT_NO_ZAPS_DELAY;
    await new Promise(resolve => setTimeout(resolve, delay));

    const zapEvents = cacheManager.getZapEvents(this.viewId);
    if (zapEvents?.length) {
      await this.renderZapListFromCache(zapEvents);
      return true;
    }
    return false;
  }

  #displayNoZapsMessage(list) {
    const message = this.config.noZapsMessage || APP_CONFIG.DIALOG_CONFIG.NO_ZAPS_MESSAGE;
    list.innerHTML = DialogComponents.createNoZapsMessageHTML(message);
    list.style.minHeight = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.MIN_HEIGHT;
  }

  // バッチ更新関連
  async batchUpdate(events, options = {}) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const existingTrigger = list.querySelector('.load-more-trigger');
      const existingItems = new Map(
        Array.from(list.querySelectorAll('.zap-list-item'))
          .map(item => [item.getAttribute('data-event-id'), item])
      );

      // イベントを時系列で並び替え
      const sortedEvents = [...events].sort((a, b) => b.created_at - a.created_at);

      // 更新が必要なイベントのみをフィルタリング
      const eventsToUpdate = sortedEvents.filter(event => {
        const existingItem = existingItems.get(event.id);
        return !existingItem || (event.reference && !existingItem.querySelector('.zap-reference'));
      });

      if (eventsToUpdate.length === 0 && !options.isFullUpdate) {
        return;
      }

      const fragment = document.createDocumentFragment();
      const updateQueue = [];

      // 既存のアイテムとの統合処理
      if (options.isFullUpdate) {
        // 完全更新の場合は全てのイベントを再構築
        const allEvents = this.#mergeAndSortEvents(
          Array.from(existingItems.values()),
          eventsToUpdate
        );

        for (const eventOrElement of allEvents) {
          if (eventOrElement instanceof Element) {
            fragment.appendChild(eventOrElement);
          } else {
            const { li, zapInfo } = await this.itemBuilder.createListItem(eventOrElement);
            fragment.appendChild(li);
            if (eventOrElement.reference) {
              updateQueue.push(() => this.updateZapReference(eventOrElement));
            }
            if (zapInfo.pubkey) {
              updateQueue.push(() => this.#updateProfileIfNeeded(zapInfo.pubkey, li));
            }
          }
        }
      } else {
        // バッファー更新の場合は既存のアイテムを維持
        existingItems.forEach(item => fragment.appendChild(item));
        
        for (const event of eventsToUpdate) {
          const { li, zapInfo } = await this.itemBuilder.createListItem(event);
          const insertPosition = this.#findInsertPosition(fragment, event.created_at);
          if (insertPosition) {
            fragment.insertBefore(li, insertPosition);
          } else {
            fragment.appendChild(li);
          }

          if (event.reference) {
            updateQueue.push(() => this.updateZapReference(event));
          }
          if (zapInfo.pubkey) {
            updateQueue.push(() => this.#updateProfileIfNeeded(zapInfo.pubkey, li));
          }
        }
      }

      // UIの更新（ローディングトリガーを保持）
      if (existingTrigger) {
        existingTrigger.remove();
      }

      list.innerHTML = '';
      list.appendChild(fragment);

      if (existingTrigger) {
        list.appendChild(existingTrigger);
      }

      // バックグラウンドで更新を実行
      if (updateQueue.length > 0) {
        requestIdleCallback(() => this.#processUpdateQueue(updateQueue));
      }

    } catch (error) {
      console.error("Failed to batch update:", error);
    }
  }

  #mergeAndSortEvents(existingElements, newEvents) {
    const merged = [];
    const elementTimestamps = new Map(
      existingElements.map(element => [
        element,
        parseInt(element.getAttribute('data-timestamp') || '0')
      ])
    );

    // 既存の要素とイベントを統合してソート
    merged.push(
      ...existingElements,
      ...newEvents
    );

    return merged.sort((a, b) => {
      const timeA = a instanceof Element ? 
        elementTimestamps.get(a) : a.created_at;
      const timeB = b instanceof Element ? 
        elementTimestamps.get(b) : b.created_at;
      return timeB - timeA;
    });
  }

  #findInsertPosition(parent, timestamp) {
    const items = Array.from(parent.children);
    return items.find(item => {
      const itemTime = parseInt(item.getAttribute('data-timestamp') || '0');
      return timestamp > itemTime;
    });
  }

  async #processUpdateQueue(queue, batchSize = 10) {
    for (let i = 0; i < queue.length; i += batchSize) {
      const batch = queue.slice(i, i + batchSize);
      await Promise.all(batch.map(update => update()));
      await new Promise(resolve => requestAnimationFrame(resolve));
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
    const PROFILE_BATCH_SIZE = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.PROFILE_BATCH;
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