import { StatusUI } from "./ui/StatusUI.js";
import { ProfileUI } from "./ui/ProfileUI.js";
import { ZapListUI } from "./ui/ZapListUI.js";
import { DialogComponents } from "./DialogComponents.js";
import { APP_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";
import styles from "./styles/styles.css";
import { formatIdentifier } from "./utils.js";  // isValidCountを削除
import { cacheManager } from "./CacheManager.js";
import { subscriptionManager } from "./ZapManager.js"; // 追加: ZapSubscriptionManager をインポート
import { statsManager } from "./StatsManager.js"; // 追加: statsManager をインポート

class NostrZapViewDialog extends HTMLElement {
  #state;

  static get observedAttributes() {
    return ["data-theme"];
  }

  constructor() {
    super();
    this.#state = {
      isInitialized: false,
      theme: APP_CONFIG.DEFAULT_OPTIONS.theme,
    };
    
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
    }
  }

  #updateTheme(theme) {
    const state = cacheManager.updateThemeState(this.viewId, { theme });
    if (state.isInitialized) {
      this.#applyTheme();
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
  async #initializeDialog() {
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    const template = document.createElement("template");
    template.innerHTML = DialogComponents.getDialogTemplate();
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    // 統計情報の初期化処理を修正
    const viewId = this.getAttribute("data-view-id");
    const identifier = this.getAttribute("data-nzv-id");
    if (identifier) {
      await statsManager.initializeStats(identifier, viewId, true);
    }

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
    // キャッシュからの表示後に無限スクロールを設定
    if (zapEventsCache.length >= APP_CONFIG.INITIAL_LOAD_COUNT) {
      subscriptionManager.setupInfiniteScroll(this.viewId);
    }
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
      // 追加: data-nzv-id属性を設定
      const button = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
      const identifier = button?.getAttribute("data-nzv-id");
      if (identifier) {
        dialog.setAttribute("data-nzv-id", identifier);
      }
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
export const displayZapStats = (stats, viewId) => 
  dialogAPI.execute(viewId, 'displayZapStats', stats);
export const replacePlaceholderWithZap = (event, index, viewId) => 
  dialogAPI.execute(viewId, 'replacePlaceholderWithZap', event, index);
export const renderZapListFromCache = (cache, viewId) => 
  dialogAPI.execute(viewId, 'renderZapListFromCache', cache);
export const prependZap = (event, viewId) => 
  dialogAPI.execute(viewId, 'prependZap', event);
// 重複している displayZapStats の宣言を削除
export const showNoZapsMessage = (viewId) => {
  try {
    const dialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (dialog) {
      dialog.showNoZapsMessage(DIALOG_CONFIG.NO_ZAPS_MESSAGE);
    }
  } catch (error) {
    console.error('Failed to show no zaps message:', error);
  }
};
