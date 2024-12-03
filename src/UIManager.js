import { StatusUI } from "./ui/StatusUI.js";
import { ProfileUI } from "./ui/ProfileUI.js";
import { ZapListUI } from "./ui/ZapListUI.js";
import { DialogComponents } from "./DialogComponents.js";  // 追加
import { APP_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";
import styles from "./styles/styles.css";
import { formatIdentifier } from "./utils.js";
import { cacheManager } from "./CacheManager.js";

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
    if (TypeChecker.isValidCount(count)) {
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
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// Export API methods
export const createDialog = (viewId) => {
  if (!document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)) {
    const dialog = document.createElement("nzv-dialog");
    dialog.setAttribute("data-view-id", viewId);
    document.body.appendChild(dialog);
    return dialog;
  }
  return null;
};

const dialogOperations = (viewId) => {
  const getDialog = () => document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
  return (operation, ...args) => {
    const dialog = getDialog();
    if (dialog) {
      return dialog[operation]?.(...args);
    }
    return null;
  };
};

export const closeDialog = (viewId) => dialogOperations(viewId)('closeDialog');
export const showDialog = (viewId) => dialogOperations(viewId)('showDialog');
export const initializeZapPlaceholders = (count, viewId) => dialogOperations(viewId)('initializeZapPlaceholders', count);
export const initializeZapStats = (viewId) => dialogOperations(viewId)('initializeZapStats');
export const replacePlaceholderWithZap = (event, index, viewId) => dialogOperations(viewId)('replacePlaceholderWithZap', event, index);
export const renderZapListFromCache = (zapEventsCache, viewId) => dialogOperations(viewId)('renderZapListFromCache', zapEventsCache);
export const prependZap = (event, viewId) => dialogOperations(viewId)('prependZap', event);
export const displayZapStats = (stats, viewId) => dialogOperations(viewId)('displayZapStats', stats);
export const showNoZapsMessage = (viewId) => dialogOperations(viewId)('showNoZapsMessage');
