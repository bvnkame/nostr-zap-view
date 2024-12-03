import { StatusUI } from "./ui/StatusUI.js";
import { ProfileUI } from "./ui/ProfileUI.js";
import { ZapListUI } from "./ui/ZapListUI.js";
import { DialogComponents } from "./DialogComponents.js";
import { APP_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";
import styles from "./styles/styles.css";
import { formatIdentifier, isValidCount } from "./utils.js";
import { cacheManager } from "./CacheManager.js";
import { subscriptionManager } from "./ZapManager.js"; // 追加: ZapSubscriptionManager をインポート

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
    const viewId = this.getAttribute("data-view-id");
    this.zapListUI = new ZapListUI(this.shadowRoot, this.profileUI, viewId);
    this.viewId = viewId;

    // ZapSubscriptionManager に zapListUI を設定
    subscriptionManager.setZapListUI(this.zapListUI);
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
    const state = cacheManager.updateThemeState(this.viewId, { theme });
    if (state.isInitialized) {
      this.#applyTheme();
    }
  }

  #updateMaxCount(count) {
    if (isValidCount(count)) {
      cacheManager.updateThemeState(this.viewId, { maxCount: count });
    }
  }

  #applyTheme() {
    const state = cacheManager.getThemeState(this.viewId);
    const themeClass = state.theme === "dark" ? "dark-theme" : "light-theme";
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

    this.#setupEventListeners();
  }

  #setupEventListeners() {
    const dialog = this.#getElement(".dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) this.closeDialog();
    });
  }

  // Public API methods
  showDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog && !dialog.open) {
      this.#updateDialogTitle();
      dialog.showModal();
    }
  }

  closeDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog?.open) {
      dialog.close();
      this.remove();
    }
  }

  // Delegate methods to specialized UI classes
  async renderZapListFromCache(zapEventsCache) {
    await this.zapListUI.renderZapListFromCache(zapEventsCache);
  }

  initializeZapStats() {
    this.statusUI.initializeStats();
  }

  displayZapStats(stats) {
    this.statusUI.displayStats(stats);
  }

  // ... その他の必要なメソッド ...

  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  #updateDialogTitle() {
    const viewId = this.getAttribute("data-view-id");
    const fetchButton = document.querySelector(
      `button[data-zap-view-id="${viewId}"]`
    );
    if (!fetchButton) return;

    const title = this.#getElement(".dialog-title");
    if (!title) return;

    const customTitle = fetchButton.getAttribute("data-title");
    if (customTitle?.trim()) {
      title.textContent = customTitle;
      title.classList.add("custom-title");
    } else {
      const identifier = fetchButton.getAttribute("data-nzv-id");
      title.textContent = DIALOG_CONFIG.DEFAULT_TITLE + formatIdentifier(identifier);
      title.classList.remove("custom-title");
    }
  }

  // UI操作メソッド
  getOperations() {
    return {
      closeDialog: () => this.closeDialog(),
      showDialog: () => this.showDialog(),
      initializeZapPlaceholders: (count) => this.zapListUI.initializeZapPlaceholders(count),
      initializeZapStats: () => this.initializeZapStats(),
      replacePlaceholderWithZap: (event, index) => this.zapListUI.replacePlaceholder(event, index),
      renderZapListFromCache: (cache) => this.renderZapListFromCache(cache),
      prependZap: (event) => this.zapListUI.prependZap(event),
      displayZapStats: (stats) => this.displayZapStats(stats),
      showNoZapsMessage: () => this.zapListUI.showNoZapsMessage()
    };
  }
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// ダイアログ操作のヘルパー関数
const createDialogAPI = () => {
  const getDialog = (viewId) => 
    document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);

  const executeOperation = (viewId, operation, ...args) => {
    const dialog = getDialog(viewId);
    return dialog?.getOperations()[operation]?.(...args) ?? null;
  };

  const createDialogIfNotExists = (viewId) => {
    if (!getDialog(viewId)) {
      const dialog = document.createElement("nzv-dialog");
      dialog.setAttribute("data-view-id", viewId);
      document.body.appendChild(dialog);
      return dialog;
    }
    return null;
  };

  return {
    create: createDialogIfNotExists,
    execute: executeOperation
  };
};

const dialogAPI = createDialogAPI();

// 公開API
export const createDialog = (viewId) => dialogAPI.create(viewId);
export const closeDialog = (viewId) => dialogAPI.execute(viewId, 'closeDialog');
export const showDialog = (viewId) => dialogAPI.execute(viewId, 'showDialog');
export const initializeZapPlaceholders = (count, viewId) => 
  dialogAPI.execute(viewId, 'initializeZapPlaceholders', count);
export const initializeZapStats = (viewId) => 
  dialogAPI.execute(viewId, 'initializeZapStats');
export const replacePlaceholderWithZap = (event, index, viewId) => 
  dialogAPI.execute(viewId, 'replacePlaceholderWithZap', event, index);
export const renderZapListFromCache = (cache, viewId) => 
  dialogAPI.execute(viewId, 'renderZapListFromCache', cache);
export const prependZap = (event, viewId) => 
  dialogAPI.execute(viewId, 'prependZap', event);
export const displayZapStats = (stats, viewId) => 
  dialogAPI.execute(viewId, 'displayZapStats', stats);
export const showNoZapsMessage = (viewId) => 
  dialogAPI.execute(viewId, 'showNoZapsMessage');
