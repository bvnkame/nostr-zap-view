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
  escapeHTML,
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
    this.statusUI = new StatusUI(this.shadowRoot);
    this.profileUI = new ProfileUI();
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
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    const template = document.createElement("template");
    template.innerHTML = DialogComponents.getDialogTemplate();
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    const dialog = this.#getElement(".dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) this.closeDialog();
    });
  }

  async #handleZapInfo(event) {
    const zapInfo = new ZapInfo(event, defaultIcon);
    return await zapInfo.extractInfo();
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

  // Simplified render methods
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
      const zapInfo = await this.#handleZapInfo(event);
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

customElements.define("nzv-dialog", NostrZapViewDialog);

// Simplified external API
export const createDialog = (viewId) => {
  if (!document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)) {
    const dialog = document.createElement("nzv-dialog");
    dialog.setAttribute("data-view-id", viewId);
    document.body.appendChild(dialog);
  }
};

// Simplified dialog operations
const dialogOperations = (viewId) => {
  const getDialog = () => document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
  return (operation, ...args) => {
    const dialog = getDialog();
    return dialog?.[operation]?.(...args);
  };
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
} = Object.fromEntries(
  ['closeDialog', 'showDialog', 'initializeZapPlaceholders', 'initializeZapStats',
   'replacePlaceholderWithZap', 'renderZapListFromCache', 'prependZap',
   'displayZapStats', 'showNoZapsMessage']
  .map(method => [method, (...args) => dialogOperations(args.pop())(method, ...args)])
);
