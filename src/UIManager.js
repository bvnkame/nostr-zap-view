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
  #initializationPromise;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    
    this.#state = {
      isInitialized: false,
      theme: APP_CONFIG.DEFAULT_OPTIONS.theme,
    };
  }

  async connectedCallback() {
    this.viewId = this.getAttribute("data-view-id");
    if (!this.viewId) {
      console.error("No viewId provided to dialog");
      return;
    }

    // 初期化を追跡可能なPromiseとして保持
    this.#initializationPromise = this.#initialize();
    
    try {
      await this.#initializationPromise;
      this.dispatchEvent(new CustomEvent('dialog-initialized', { 
        detail: { viewId: this.viewId }
      }));
    } catch (error) {
      console.error("Dialog initialization failed:", error);
    }
  }

  async #initialize() {
    // 早期リターンを追加
    if (!this.viewId) {
      console.error("Cannot initialize dialog without viewId");
      return;
    }

    // configの取得を先に行う
    const config = subscriptionManager.getViewConfig(this.viewId);
    console.log('NostrZapViewDialog initializing with config:', {
      viewId: this.viewId,
      config
    });

    if (!config) {
      console.error(`Config not found for viewId: ${this.viewId}`);
      return;
    }

    // DOMとスタイルの初期化
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    const template = document.createElement("template");
    template.innerHTML = DialogComponents.getDialogTemplate();
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    // UIコンポーネントの初期化
    this.statusUI = new StatusUI(this.shadowRoot);
    this.profileUI = new ProfileUI();
    this.zapListUI = new ZapListUI(this.shadowRoot, this.profileUI, this.viewId, config);
    subscriptionManager.setZapListUI(this.zapListUI);

    // イベントリスナーの設定
    this.#setupEventListeners();

    // 初期化完了フラグを設定
    this.#state.isInitialized = true;
    console.log(`Dialog initialization complete for viewId: ${this.viewId}`);

    // 統計情報の初期化は別途行う
    this.#initializeStats();
  }

  async #initializeStats() {
    const identifier = this.getAttribute("data-nzv-id");
    if (identifier) {
      try {
        const stats = await statsManager.initializeStats(identifier, this.viewId, true);
        if (stats && this.#state.isInitialized) {
          this.statusUI.displayStats(stats);
        }
      } catch (error) {
        console.error("Failed to initialize stats:", error);
      }
    }
  }

  #getConfig() {
    if (!this.viewId) return null;
    const config = subscriptionManager.getViewConfig(this.viewId);
    console.log('NostrZapViewDialog getting config:', { viewId: this.viewId, config });
    return config;
  }

  static get observedAttributes() {
    return ["data-theme"];
  }

  #setupEventListeners() {
    const dialog = this.#getElement(".dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) this.closeDialog();
    });
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
    // 初期化が完了していない場合はnullを返す
    if (!this.#state.isInitialized) {
      console.warn(`Operations not available - dialog not initialized for viewId: ${this.viewId}`);
      return null;
    }

    return {
      closeDialog: () => this.closeDialog(),
      showDialog: () => this.showDialog(),
      replacePlaceholderWithZap: (event, index) => this.zapListUI?.replacePlaceholder(event, index),
      renderZapListFromCache: (cache) => this.zapListUI?.renderZapListFromCache(cache),
      prependZap: (event) => this.zapListUI?.prependZap(event),
      displayZapStats: (stats) => this.statusUI?.displayStats(stats),
      showNoZapsMessage: () => this.zapListUI?.showNoZapsMessage()
    };
  }

  // 初期化の完了を待機するメソッドを追加
  async waitForInitialization() {
    return this.#initializationPromise;
  }
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// ダイアログ操作のヘルパー関数
const dialogManager = {
  create: async (viewId, config) => {
    console.log('Creating dialog for viewId:', viewId, 'with config:', config);
    
    if (!viewId || !config) {
      console.error('Invalid viewId or config:', { viewId, config });
      return Promise.reject(new Error('Invalid viewId or config'));
    }

    // 既存のダイアログをチェック
    const existingDialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (existingDialog) return Promise.resolve(existingDialog);

    // configを先に設定
    subscriptionManager.setViewConfig(viewId, config);

    const dialog = document.createElement("nzv-dialog");
    dialog.setAttribute("data-view-id", viewId);
    dialog.setAttribute("data-config", JSON.stringify(config));

    const button = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
    if (button?.getAttribute("data-nzv-id")) {
      dialog.setAttribute("data-nzv-id", button.getAttribute("data-nzv-id"));
    }

    document.body.appendChild(dialog);
    
    // 初期化完了を待機
    await dialog.waitForInitialization();
    return dialog;
  },

  get: (viewId) => document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`),

  execute: (viewId, operation, ...args) => {
    const dialog = dialogManager.get(viewId);
    const operations = dialog?.getOperations();
    if (!operations) {
      console.warn(`Dialog operations not available for ${viewId}`);
      return null;
    }
    return operations[operation]?.(...args) ?? null;
  }
};

// 公開APIも非同期に変更
export async function createDialog(viewId) {
  try {
    const config = subscriptionManager.getViewConfig(viewId);
    if (!config) {
      throw new Error(`View configuration not found for viewId: ${viewId}`);
    }

    const dialog = await dialogManager.create(viewId, config);
    return dialog;
  } catch (error) {
    console.error('Failed to create dialog:', error);
    return null;
  }
}

export async function showDialog(viewId) {
  try {
    const dialog = await dialogManager.get(viewId);
    if (!dialog) {
      throw new Error('Dialog not found');
    }

    await dialog.waitForInitialization();
    const operations = dialog.getOperations();
    if (!operations) {
      throw new Error('Dialog not properly initialized');
    }

    await operations.showDialog();
  } catch (error) {
    console.error('Failed to show dialog:', error);
  }
}

// 以下のエクスポート関数を修正
export const closeDialog = (viewId) => dialogManager.execute(viewId, 'closeDialog');
export const displayZapStats = (stats, viewId) => dialogManager.execute(viewId, 'displayZapStats', stats);
export const replacePlaceholderWithZap = (event, index, viewId) => 
  dialogManager.execute(viewId, 'replacePlaceholderWithZap', event, index);
export const renderZapListFromCache = (cache, viewId) => 
  dialogManager.execute(viewId, 'renderZapListFromCache', cache);
export const prependZap = (event, viewId) => dialogManager.execute(viewId, 'prependZap', event);
export const showNoZapsMessage = (viewId) => dialogManager.execute(viewId, 'showNoZapsMessage');
