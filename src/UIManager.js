import { statsUI } from "./ui/StatsUI.js";
import { ProfileUI } from "./ui/ProfileUI.js";
import { ZapListUI } from "./ui/ZapListUI.js";
import { DialogComponents } from "./DialogComponents.js";
import { APP_CONFIG } from "./AppSettings.js";
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
    this.#initializationPromise = this.#initializeBasicDOM();
    
    try {
      await this.#initializationPromise;
      this.#state.isInitialized = true;
      
      // フルUIの初期化を実行
      const config = subscriptionManager.getViewConfig(this.viewId);
      if (!config) {
        throw new Error("Config is required for initialization");
      }
      await this.#initializeFullUI(config);
      
      // 統計情報の初期化 - 既に初期化されている場合は既存のデータを使用
      const identifier = this.getAttribute("data-nzv-id");
      if (identifier) {
        const stats = await statsManager.getCurrentStats(this.viewId);
        if (stats) {
          this.statsUI.displayStats(stats);
        }
      }
      
      this.#state.isInitialized = true;
      this.dispatchEvent(new CustomEvent('dialog-initialized', { 
        detail: { viewId: this.viewId }
      }));
    } catch (error) {
      console.error("Dialog initialization failed:", error);
    }
  }


  async #initializeBasicDOM() {
    return new Promise(resolve => {
      // 基本的なダイアログ構造の初期化
      const template = document.createElement("template");
      template.innerHTML = DialogComponents.getDialogTemplate();
      this.shadowRoot.appendChild(template.content.cloneNode(true));
      
      this.#setupEventListeners();
      
      // マイクロタスクで完了を確認
      queueMicrotask(() => resolve());
    });
  }

  async #initializeFullUI(config) {

    // スタイルシートの追加
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    // UIコンポーネントの初期化
    this.statsUI = new statsUI(this.shadowRoot);
    this.profileUI = new ProfileUI();
    this.zapListUI = new ZapListUI(this.shadowRoot, this.profileUI, this.viewId, config);

    subscriptionManager.setZapListUI(this.zapListUI);

    // UIコンポーネントの初期化の後に
    // viewId に基づいて正しいイベントを取得
    const zapEvents = cacheManager.getZapEvents(this.viewId);

    if (!zapEvents?.length) {
      this.zapListUI.showNoZapsMessage();
    } else {
      await this.zapListUI.renderZapListFromCache(zapEvents);
    }

    // 統計情報の初期化 - キャッシュされたデータを優先的に使用
    const identifier = this.getAttribute("data-nzv-id");
    if (identifier) {
      const cachedStats = await cacheManager.getCachedStats(this.viewId, identifier);
      if (cachedStats?.stats) {
        this.statsUI.displayStats(cachedStats.stats);
      } else {
        const currentStats = await statsManager.getCurrentStats(this.viewId);
        if (currentStats) {
          this.statsUI.displayStats(currentStats);
        }
      }
    }
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

    // スペースキーでのスクロール制御を追加
    document.addEventListener("keydown", (e) => {
      if (dialog?.open) {
        if (e.key === "Escape") {
          this.closeDialog();
        } else if (e.key === " ") {
          e.preventDefault();
          const zapList = this.#getElement(".dialog-zap-list");
          if (zapList) {
            zapList.scrollTop += zapList.clientHeight * 0.8;
          }
        }
      }
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
  async showDialog() {
    await this.#initializationPromise; // 基本初期化の完了を待つ
    const dialog = this.#getElement(".dialog");
    if (!dialog || dialog.open || !this.#state.isInitialized) {
      console.warn("Cannot show dialog - not properly initialized");
      return;
    }

    dialog.showModal();
    queueMicrotask(() => {
      if (document.activeElement) {
        document.activeElement.blur();
      }
    });
    this.#updateDialogTitle();
    
  }

  closeDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog?.open) {
      this.zapListUI?.destroy();
      // UIのクリーンアップのみを行い、キャッシュはそのまま保持
      subscriptionManager.unsubscribe(this.viewId);
      dialog.close();
      this.remove();
      
    }
  }


  displayZapStats(stats) {
    this.statsUI.displayStats(stats);
  }

  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  #updateDialogTitle() {
    const viewId = this.getAttribute("data-view-id");
    const fetchButton = document.querySelector(
      `button[data-zap-view-id="${viewId}"]`
    );
    if (!fetchButton) return;

    const titleContainer = this.#getElement(".dialog-title");
    const title = this.#getElement(".dialog-title a");
    if (!title || !titleContainer) return;

    const customTitle = fetchButton.getAttribute("data-title");
    const identifier = fetchButton.getAttribute("data-nzv-id");
    
    title.href = identifier ? `https://njump.me/${identifier}` : '#';
    
    if (customTitle?.trim()) {
      title.textContent = customTitle;
      titleContainer.classList.add("custom-title");
    } else {
      title.textContent = APP_CONFIG.DIALOG_CONFIG.DEFAULT_TITLE + formatIdentifier(identifier);
      titleContainer.classList.remove("custom-title");
    }
  }

  // UI操作メソッド
  getOperations() {
    // 基本初期化チェック
    if (!this.#state.isInitialized) {
      console.warn(`Basic initialization not complete for viewId: ${this.viewId}`);
      return null;
    }

    const operations = {
      closeDialog: () => this.closeDialog(),
      showDialog: () => this.showDialog(),
    };

    // 完全な初期化が完了している場合のみ追加の操作を提供
    if (this.#state.isInitialized) {
      Object.assign(operations, {
        prependZap: (event) => this.zapListUI?.prependZap(event),
        displayZapStats: (stats) => this.statsUI?.displayStats(stats),
        showNoZapsMessage: () => this.zapListUI?.showNoZapsMessage()
      });
    }

    return operations;
  }

  // ��期化の完了を待機するメソッドを追加
  async waitForInitialization() {
    return this.#initializationPromise;
  }
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// ダイアログ操作のヘルパー関数
const dialogManager = {
  create: async (viewId, config) => {
    
    if (!viewId || !config) {
      console.error('Invalid viewId or config:', { viewId, config });
      return Promise.reject(new Error('Invalid viewId or config'));
    }

    // configを先に設定
    subscriptionManager.setViewConfig(viewId, config);

    const existingDialog = document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`);
    if (existingDialog) return existingDialog;

    const dialog = document.createElement("nzv-dialog");
    dialog.setAttribute("data-view-id", viewId);
    dialog.setAttribute("data-config", JSON.stringify(config));

    const button = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
    if (button?.getAttribute("data-nzv-id")) {
      dialog.setAttribute("data-nzv-id", button.getAttribute("data-nzv-id"));
    }

    document.body.appendChild(dialog);
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

    // configを先に設定
    subscriptionManager.setViewConfig(viewId, config);

    const dialog = await dialogManager.create(viewId, config);

    return dialog;
  } catch (error) {
    console.error('[Dialog] Creation failed:', error);
    return null;
  }
}

export async function showDialog(viewId) {
  try {
    const dialog = dialogManager.get(viewId);
    if (!dialog) {
      throw new Error('Dialog not found');
    }

    // 基本初期化の完了だけを待つ
    await dialog.waitForInitialization();
    const operations = dialog.getOperations();
    if (!operations?.showDialog) {
      throw new Error('Basic dialog operations not available');
    }

    operations.showDialog();
  } catch (error) {
    console.error('Failed to show dialog:', error);
  }
}

// 以下のエクスポート関数を修正
export const closeDialog = (viewId) => {
  const dialog = dialogManager.get(viewId);
  if (dialog) {
    subscriptionManager.unsubscribe(viewId);
    dialog.closeDialog();
  }
};
export const displayZapStats = (stats, viewId) => dialogManager.execute(viewId, 'displayZapStats', stats);
export const replacePlaceholderWithZap = (event, index, viewId) => 
  dialogManager.execute(viewId, 'replacePlaceholderWithZap', event, index);
export const prependZap = (event, viewId) => dialogManager.execute(viewId, 'prependZap', event);
export const showNoZapsMessage = (viewId) => {
  const dialog = dialogManager.get(viewId);
  const operations = dialog?.getOperations();
  if (!operations?.showNoZapsMessage) return;
  operations.showNoZapsMessage();
};
