import { ZapInfo } from "./ZapInfo.js";
import { DialogComponents } from "./DialogComponents.js";
import { StatusUI } from "./StatusUI.js";
import { ProfileUI } from "./ProfileUI.js";
import { APP_CONFIG, ZAP_AMOUNT_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon.svg";
import {
  isWithin24Hours,
  getAmountColorClass,
  isColorModeEnabled,
  createNoZapsMessage,
  formatIdentifier,
  escapeHTML,  // 追加
} from "./utils.js";

class NostrZapViewDialog extends HTMLElement {
  static get observedAttributes() {
    return ["data-theme", "data-max-count"];
  }

  #state = {
    isInitialized: false,
    theme: APP_CONFIG.DEFAULT_OPTIONS.theme,
    maxCount: APP_CONFIG.DEFAULT_OPTIONS.maxCount,
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.statusUI = null;  // renamed from uiStatus
    this.profileUI = new ProfileUI();  // Add ProfileUI instance
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case "data-theme":
        this.#updateTheme(newValue);
        break;
      case "data-max-count":
        this.#updateMaxCount(parseInt(newValue, 10));
        break;
    }
  }

  #updateTheme(theme) {
    this.#state.theme = theme;
    if (this.#state.isInitialized) {
      this.#applyTheme();
    }
  }

  #updateMaxCount(count) {
    if (TypeChecker.isValidCount(count)) {
      this.#state.maxCount = count;
    }
  }

  #applyTheme() {
    // Implement the theme application logic here
    const themeClass =
      this.#state.theme === "dark" ? "dark-theme" : "light-theme";
    this.shadowRoot.host.classList.add(themeClass);
  }

  // Lifecycle methods
  connectedCallback() {
    this.#initializeDialog();
  }

  // Initialization methods
  #initializeDialog() {
    this.#setupStyles();
    this.#setupTemplate();
    this.#setupEventListeners();
    this.statusUI = new StatusUI(this.shadowRoot);  // renamed from uiStatus
  }

  #setupStyles() {
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);
  }

  #setupTemplate() {
    const template = document.createElement("template");
    template.innerHTML = `
      <dialog class="dialog">
        <h2 class="dialog-title"></h2>
        <button class="close-dialog-button">X</button>
        <div class="zap-stats"></div>
        <ul class="dialog-zap-list"></ul>
      </dialog>
    `;
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  #setupEventListeners() {
    const dialog = this.#getElement(".dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", this.#onDialogClick.bind(this));
  }

  #onDialogClick(event) {
    if (event.target === this.#getElement(".dialog")) {
      this.closeDialog();
    }
  }

  async extractZapInfo(event) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    const info = await zapInfo.extractInfo();
    return info; // 修正: referenceを再設���せず、そのまま返す
  }

  async #loadProfileAndUpdate(pubkey, element) {
    if (!pubkey || !element) return;
  
    try {
      await this.profileUI.loadAndUpdate(pubkey, element);
    } catch (error) {
      console.error("Failed to load profile:", error);
    }
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!this.#isValidPlaceholder(placeholder)) return;

    try {
      const zapInfo = await this.extractZapInfo(event);
      this.#updatePlaceholderContent(placeholder, zapInfo, event.id);
      await this.#updateProfileIfNeeded(zapInfo.pubkey, placeholder);
    } catch (error) {
      console.error("Failed to replace placeholder:", error);
      placeholder.remove();
    }
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

  async renderZapListFromCache(zapEventsCache) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      if (!zapEventsCache || zapEventsCache.length === 0) {
        this.showNoZapsMessage();
        return;
      }

      // 既存のトリガー要素を保存
      const existingTrigger = list.querySelector('.load-more-trigger');

      // 既存のイベントIDとその要素のマップを作成（HTMLコンテンツと要素自体を保持）
      const existingEvents = new Map(
        Array.from(list.children)
          .filter(li => li.hasAttribute('data-event-id'))
          .map(li => [li.getAttribute('data-event-id'), {
            element: li,
            html: li.innerHTML,
            classes: li.className
          }])
      );

      // 重複のないソート済みのイベントリストを作成
      const uniqueEvents = [...new Map(zapEventsCache.map(e => [e.id, e])).values()]
        .sort((a, b) => b.created_at - a.created_at);

      const fragment = document.createDocumentFragment();
      const newProfileUpdates = [];

      // プレースホルダーを削除
      Array.from(list.querySelectorAll('.placeholder')).forEach(el => el.remove());

      for (const event of uniqueEvents) {
        const existingEvent = existingEvents.get(event.id);
        let li;

        if (existingEvent) {
          // 既存の要素を再利用
          li = existingEvent.element;
        } else {
          // 新規要素を作成
          li = document.createElement("li");
          const zapInfo = await this.extractZapInfo(event);
          const colorClass = getAmountColorClass(zapInfo.satsAmount, ZAP_AMOUNT_CONFIG.THRESHOLDS);
          
          li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
          li.setAttribute("data-pubkey", zapInfo.pubkey);
          li.setAttribute("data-event-id", event.id);
          
          li.innerHTML = this.#createZapHTML(zapInfo);
          
          if (zapInfo.pubkey) {
            newProfileUpdates.push({ pubkey: zapInfo.pubkey, element: li });
          }
        }
        fragment.appendChild(li);
      }

      // リストを一括更新
      list.innerHTML = '';
      list.appendChild(fragment);

      // 保存しておいたトリガー要素を再追加
      if (existingTrigger) {
        list.appendChild(existingTrigger);
      }

      // 新しいプロフィール情報のみを非同期で更新
      if (newProfileUpdates.length > 0) {
        // プロフィール情報を即座にロードするように修正
        for (const { pubkey, element } of newProfileUpdates) {
          await this.#loadProfileAndUpdate(pubkey, element);
        }
      }

    } catch (error) {
      console.error("Failed to render zap list:", error);
      this.showNoZapsMessage();
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
      const zapInfo = await this.extractZapInfo(event);

      const colorClass = getAmountColorClass(zapInfo.satsAmount, ZAP_AMOUNT_CONFIG.THRESHOLDS);
      const li = document.createElement("li");
      li.className = `zap-list-item ${colorClass}${
        zapInfo.comment ? " with-comment" : ""
      }`;
      li.setAttribute("data-pubkey", zapInfo.pubkey);
      li.innerHTML = this.#createZapHTML(zapInfo);

      list.prepend(li);

      // プロフィール情報を非同期で更新
      if (zapInfo.pubkey) {
        this.#loadProfileAndUpdate(zapInfo.pubkey, li).catch(console.error);
      }
    } catch (error) {
      console.error("Failed to prepend zap:", error);
    }
  }

  #getAmountColorClass(amount) {
    if (!this.#isColorModeEnabled()) return "";

    return getAmountColorClass(amount, ZAP_AMOUNT_CONFIG.THRESHOLDS);
  }

  #isColorModeEnabled() {
    // Fix: Get the correct button for this dialog using viewId
    const viewId = this.getAttribute("data-view-id");
    const button = document.querySelector(
      `button[data-zap-view-id="${viewId}"]`
    );
    return isColorModeEnabled(button, APP_CONFIG.DEFAULT_OPTIONS.colorMode);
  }

  // UI element creation methods
  #createZapHTML(zapInfo) {
    const components = DialogComponents.createUIComponents(
      zapInfo,
      this.getAttribute("data-view-id")
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

  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  // Public API
  showDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog && !dialog.open) {
      const viewId = this.getAttribute("data-view-id");
      const fetchButton = document.querySelector(
        `button[data-zap-view-id="${viewId}"]`
      );
      if (fetchButton) {
        const title = this.#getElement(".dialog-title");
        const customTitle = fetchButton.getAttribute("data-title");
        if (customTitle && customTitle.trim()) {
          title.textContent = customTitle;
          title.classList.add("custom-title");
        } else {
          const identifier = fetchButton.getAttribute("data-nzv-id");
          title.textContent = DIALOG_CONFIG.DEFAULT_TITLE + formatIdentifier(identifier);
          title.classList.remove("custom-title");
        }
      }

      // リストをクリアせずにダイアログを表示
      dialog.showModal();
    }
  }

  closeDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog?.open) {
      dialog.close();
      // ダイアログを閉じた後に要素自体を削除
      this.remove();
    }
  }

  // Zap display methods
  initializeZapPlaceholders(count) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    // デフォルト値とバリデーションを追加
    const defaultCount = APP_CONFIG.INITIAL_LOAD_COUNT;
    const validCount = Math.max(1, Math.min(
      Number.isInteger(parseInt(count)) ? parseInt(count) : defaultCount,
      DIALOG_CONFIG.MAX_DISPLAY_LIMIT  // 最大表示制限
    ));

    // プレースホルダーにIDを付与して追跡可能にする
    list.innerHTML = Array(validCount)
      .fill(null)
      .map(
        (_, i) => `
        <li class="zap-list-item placeholder" data-index="${i}">
          <div class="zap-sender">
            <div class="sender-icon">
              <div class="zap-placeholder-icon skeleton"></div>
            </div>
            <div class="sender-info">
              <div class="zap-placeholder-name skeleton"></div>
              <div class="sender-pubkey skeleton"></div>
            </div>
            <div class="zap-amount skeleton"></div>
          </div>
        </li>
      `
      )
      .join("");
  }

  initializeZapStats() {
    this.statusUI.initializeStats();  // renamed from uiStatus
  }

  displayZapStats(stats) {
    this.statusUI.displayStats(stats);  // renamed from uiStatus
  }

  showNoZapsMessage() {
    const list = this.#getElement(".dialog-zap-list");
    if (list) {
      list.innerHTML = createNoZapsMessage(DIALOG_CONFIG);
    }
  }
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// Simplified external API
export const createDialog = (viewId) => {
  if (!document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)) {
    const dialog = document.createElement("nzv-dialog");
    dialog.setAttribute("data-view-id", viewId);
    document.body.appendChild(dialog);
  }
};

export const {
  closeDialog,
  showDialog,
  initializeZapPlaceholders,
  initializeZapStats,
  replacePlaceholderWithZap,
  renderZapListFromCache,
  prependZap,
  displayZapStats,
  showNoZapsMessage,
} = (() => {
  const getDialog = (viewId) =>
    document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);

  return {
    closeDialog: (viewId) => getDialog(viewId)?.closeDialog(),
    showDialog: (viewId) => getDialog(viewId)?.showDialog(),
    initializeZapPlaceholders: (maxCount, viewId) =>
      getDialog(viewId)?.initializeZapPlaceholders(maxCount),
    initializeZapStats: (viewId) => getDialog(viewId)?.initializeZapStats(),
    replacePlaceholderWithZap: (event, index, viewId) =>
      getDialog(viewId)?.replacePlaceholderWithZap(event, index),
    renderZapListFromCache: async (cache, viewId) => {
      const dialog = getDialog(viewId);
      if (!dialog) return;

      console.log('[UIManager] キャッシュからの表示開始:', {
        cacheSize: cache.length,
        viewId
      });

      if (cache.length === 0) {
        dialog.showNoZapsMessage();
        return;
      }

      const sortedZaps = [...cache].sort((a, b) => b.created_at - a.created_at);
      await dialog.renderZapListFromCache(sortedZaps);
    },
    prependZap: (event, viewId) => getDialog(viewId)?.prependZap(event, viewId),
    displayZapStats: (stats, viewId) =>
      getDialog(viewId)?.displayZapStats(stats),
    showNoZapsMessage: (viewId) => getDialog(viewId)?.showNoZapsMessage(),
  };
})();
