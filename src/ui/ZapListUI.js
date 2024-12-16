import { DialogComponents } from "../DialogComponents.js";
import { APP_CONFIG } from "../AppSettings.js";
import { cacheManager } from "../CacheManager.js";

class ZapItemBuilder {
  constructor(viewId, config) {
    this.viewId = viewId;
    this.config = config;
  }

  async createListItem(event) {
    const zapInfo = await DialogComponents.ZapInfo.createFromEvent(event, {
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

    // リストをクリア
    const list = this.#getElement(".dialog-zap-list");
    if (list) {
      list.innerHTML = '';
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
    if (existingTrigger) {
      existingTrigger.remove();
    }

    // 既存のアイテムを維持しながら新しいアイテムを追加
    Array.from(fragment.children).forEach(newItem => {
      const eventId = newItem.getAttribute('data-event-id');
      const timestamp = parseInt(newItem.getAttribute('data-timestamp'));
      
      // 適切な挿入位置を見つける
      let insertPosition = null;
      const items = Array.from(list.children);
      for (let i = 0; i < items.length; i++) {
        const itemTimestamp = parseInt(items[i].getAttribute('data-timestamp'));
        if (timestamp > itemTimestamp) {
          insertPosition = items[i];
          break;
        }
      }

      // 重複チェックと挿入
      const existingItem = list.querySelector(
        `.zap-list-item[data-event-id="${eventId}"]`
      );
      if (!existingItem) {
        if (insertPosition) {
          list.insertBefore(newItem, insertPosition);
        } else {
          list.appendChild(newItem);
        }
      }
    });

    // トリガーを最後に追加
    if (existingTrigger) {
      list.appendChild(existingTrigger);
    }
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

  async renderZapListFromCache(events) {
    console.log('renderZapListFromCache', events);
    if (!events?.length) {
      cacheManager.setNoZapsState(this.viewId, false);
      return this.showNoZapsMessage();
    }

    await this.#updateListContent(async (list) => {
      const { initialBatch, remainingBatch } = this.#prepareEventBatches(events);
      
      // 初期バッチの処理
      const { fragment, profileUpdates } = await this.#processInitialBatch(initialBatch);
      this.#updateList(list, fragment);

      // 残りのバッチを非同期で処理
      if (remainingBatch.length > 0) {
        this.#processRemainingBatchAsync(remainingBatch, list, profileUpdates);
      } else {
        await this.#updateProfiles(profileUpdates);
      }
    });
  }

  #prepareEventBatches(events) {
    console.log('Total events:', events.length);
    const uniqueEvents = this.#getUniqueEvents(events);
    console.log('Unique events:', uniqueEvents.length);
    const INITIAL_BATCH = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.INITIAL_BATCH;
    
    return {
      initialBatch: uniqueEvents.slice(0, INITIAL_BATCH),
      remainingBatch: uniqueEvents.slice(INITIAL_BATCH)
    };
  }

  async #processInitialBatch(events) {
    const fragment = document.createDocumentFragment();
    const profileUpdates = [];

    for (const event of events) {
      const { li, zapInfo } = await this.itemBuilder.createListItem(event);
      this.#handleCachedReference(event.id, li);
      fragment.appendChild(li);
      if (zapInfo.pubkey) {
        profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
      }
    }

    return { fragment, profileUpdates };
  }

  #processRemainingBatchAsync(remainingEvents, list, profileUpdates) {
    if (!remainingEvents.length) return;

    // バッチサイズを大きくして処理効率を上げる
    const batchSize = APP_CONFIG.DIALOG_CONFIG.ZAP_LIST.REMAINING_BATCH;
    let currentIndex = 0;

    const processNextBatch = async () => {
      if (currentIndex >= remainingEvents.length) {
        await this.#updateProfiles(profileUpdates);
        return;
      }

      const currentBatch = remainingEvents.slice(
        currentIndex,
        currentIndex + batchSize
      );

      await this.#processBatch(currentBatch, list, profileUpdates);
      currentIndex += batchSize;

      // 次のバッチを非同期で処理
      setTimeout(() => processNextBatch(), 0);
    };

    requestIdleCallback(() => processNextBatch());
  }

  async #processBatch(batch, list, profileUpdates) {
    // fragment作成
    const batchFragment = document.createDocumentFragment();

    // すべてのイベントを処理
    await Promise.all(batch.map(async (event) => {
      const { li, zapInfo } = await this.itemBuilder.createListItem(event);
      this.#handleCachedReference(event.id, li);
      batchFragment.appendChild(li);
      if (zapInfo.pubkey) {
        profileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
      }
    }));

    // リストに追加（既存のアイテムは保持）
    const existingTrigger = list.querySelector('.load-more-trigger');
    if (existingTrigger) {
      existingTrigger.remove();
    }
    list.appendChild(batchFragment);
    if (existingTrigger) {
      list.appendChild(existingTrigger);
    }

    // UIの更新を待つ
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  async prependZap(event) {
    return this.#createAndAddZapElement(event, (list, li) => list.prepend(li));
  }

  async appendZap(event) {
    return this.#createAndAddZapElement(event, (list, li) => {
      const position = this.#findInsertPosition(list, event.created_at);
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
    console.log('batchUpdate', events, options);
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const existingItems = new Map(
        Array.from(list.querySelectorAll('.zap-list-item'))
          .map(item => [item.getAttribute('data-event-id'), item])
      );

      const uniqueEvents = this.#getUniqueEvents(events);

      const eventsToUpdate = uniqueEvents.filter(event => {
        const existingItem = existingItems.get(event.id);
        return !existingItem || (event.reference && !existingItem.querySelector('.zap-reference'));
      });

      if (eventsToUpdate.length === 0 && !options.isFullUpdate) {
        return;
      }

      const fragment = document.createDocumentFragment();

      for (const event of eventsToUpdate) {
        const { li, zapInfo } = await this.itemBuilder.createListItem(event);
        if (event.reference) {
          this.updateZapReference(event);
        }
        fragment.appendChild(li);
        if (zapInfo.pubkey) {
          await this.#updateProfileIfNeeded(zapInfo.pubkey, li);
        }
      }

      // リストを更新します。
      this.#updateList(list, fragment);

    } catch (error) {
      console.error("Failed to batch update:", error);
    }
  }


  #findInsertPosition(parent, timestamp) {
    const items = Array.from(parent.children);
    return items.find(item => {
      const itemTime = parseInt(item.getAttribute('data-timestamp') || '0');
      return timestamp > itemTime;
    });
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