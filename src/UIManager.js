import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon.svg";
import arrowRightIcon from "./assets/arrow_right.svg"; // 追加
import quickReferenceIcon from "./assets/link.svg"; // 追加
import {
  formatIdentifier,
  parseZapEvent,
  isWithin24Hours,
  escapeHTML,
  isEventIdentifier, // Add import
  encodeNevent,   // Add import
  encodeNpub, // Add import
  extractReferenceFromTags, // Add import
  createDefaultZapInfo, // Add import
  getAmountColorClass, // Add import
  isColorModeEnabled, // Add import
  createNoZapsMessage, // Add import
} from "./utils.js";
import { APP_CONFIG, ZAP_AMOUNT_CONFIG, DIALOG_CONFIG } from "./AppSettings.js";
import { StatusUI } from "./StatusUI.js";  // updated import
import { ProfileUI } from "./ProfileUI.js"; // Add import

// Zapイベント情報を扱うクラス
class ZapInfo {
  constructor(event, defaultIcon) {
    this.event = event;
    this.defaultIcon = defaultIcon;
  }

  async extractInfo() {
    try {
      const { pubkey, content, satsText } = await parseZapEvent(
        this.event,
        this.defaultIcon
      );
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
      const normalizedPubkey = typeof pubkey === "string" ? pubkey : null;

      // referenceの抽出を単純化
      const reference = this.event.reference || extractReferenceFromTags(this.event);

      return {
        satsText,
        satsAmount,
        comment: content || "",
        pubkey: normalizedPubkey || "",
        created_at: this.event.created_at,
        displayIdentifier: normalizedPubkey
          ? formatIdentifier(encodeNpub(normalizedPubkey))
          : "anonymous",
        senderName: null,
        senderIcon: null,
        reference,
      };
    } catch (error) {
      console.error("Failed to extract zap info:", error, this.event);
      return createDefaultZapInfo(this.event, this.defaultIcon);
    }
  }

  #extractReferenceFromTags() {
    if (!this.event.tags) return null;
    
    const eTag = this.event.tags.find((tag) => tag[0] === "e");
    const pTag = this.event.tags.find((tag) => tag[0] === "p");
    
    if (!eTag) return null;

    return {
      id: eTag[1],
      kind: parseInt(eTag[3], 10) || 1,
      pubkey: pTag?.[1] || this.event.pubkey || "",
      content: this.event.content || "",
      tags: this.event.tags || [],
    };
  }

  #createDefaultInfo() {
    return {
      satsText: "Amount: Unknown",
      satsAmount: 0,
      comment: "",
      pubkey: "",
      created_at: this.event.created_at,
      displayIdentifier: "anonymous",
      senderName: "anonymous",
      senderIcon: this.defaultIcon,
      reference: null,
    };
  }
}

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
    return info; // 修正: referenceを再設定せず、そのまま返す
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
    if (!placeholder || !placeholder.classList.contains('placeholder')) return;

    try {
      const zapInfo = await this.extractZapInfo(event);
      const colorClass = getAmountColorClass(zapInfo.satsAmount, ZAP_AMOUNT_CONFIG.THRESHOLDS);

      // プレースホルダーを実際のZap情報で置き換え
      placeholder.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
      placeholder.setAttribute("data-pubkey", zapInfo.pubkey);
      placeholder.setAttribute("data-event-id", event.id);
      placeholder.innerHTML = this.#createZapHTML(zapInfo);

      // プレースホルダーマーカーを削除
      placeholder.removeAttribute('data-index');

      if (zapInfo.pubkey) {
        this.#loadProfileAndUpdate(zapInfo.pubkey, placeholder);
      }
    } catch (error) {
      console.error("Failed to replace placeholder:", error);
      // エラー時はプレースホルダーを削除
      placeholder.remove();
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

      // 既存のイベントIDとその要素のマップを作成
      const existingEvents = new Map(
        Array.from(list.children)
          .filter(li => li.hasAttribute('data-event-id'))
          .map(li => [li.getAttribute('data-event-id'), li])
      );

      // 重複のないソート済みのイベントリストを作成
      const uniqueEvents = [...new Map(zapEventsCache.map(e => [e.id, e])).values()]
        .sort((a, b) => b.created_at - a.created_at);

      const fragment = document.createDocumentFragment();
      const newProfileUpdates = [];

      // プレースホルダーを削除
      Array.from(list.querySelectorAll('.placeholder')).forEach(el => el.remove());

      for (const event of uniqueEvents) {
        // 既存の要素があれば再利用、なければ新規作成
        let li = existingEvents.get(event.id);
        if (!li) {
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

      // バックグラウンドでプロフィール情報を更新
      if (newProfileUpdates.length > 0) {
        requestIdleCallback(() => {
          newProfileUpdates.forEach(({ pubkey, element }) => {
            this.#loadProfileAndUpdate(pubkey, element).catch(console.error);
          });
        });
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
  #createUIComponents(zapInfo) {
    const iconComponent = this.#createIconComponent(zapInfo);
    const nameComponent = this.#createNameComponent(zapInfo);
    const pubkeyComponent = this.#createPubkeyComponent(zapInfo);

    // referenceComponentの生成を条件付きに
    const viewId = this.getAttribute("data-view-id");
    const identifier =
      document
        .querySelector(`button[data-zap-view-id="${viewId}"]`)
        ?.getAttribute("data-nzv-id") || "";
    const referenceComponent = !isEventIdentifier(identifier)
      ? this.#createReferenceComponent(zapInfo)
      : "";

    return {
      iconComponent,
      nameComponent,
      pubkeyComponent,
      referenceComponent,
    };
  }

  #createIconComponent({ senderIcon, senderName }) {
    return `<div class="zap-placeholder-icon skeleton"></div>`;
  }

  #createNameComponent({ senderName }) {
    return senderName
      ? `<span class="sender-name">${escapeHTML(senderName)}</span>`
      : `<div class="zap-placeholder-name skeleton"></div>`;
  }

  #createPubkeyComponent({ pubkey, displayIdentifier, reference }) {
    const viewId = this.getAttribute("data-view-id");
    const identifier =
      document
        .querySelector(`button[data-zap-view-id="${viewId}"]`)
        ?.getAttribute("data-nzv-id") || "";
    const shouldShowReference = !isEventIdentifier(identifier);

    return reference && shouldShowReference
      ? `<span class="sender-pubkey" data-pubkey="${pubkey}">${displayIdentifier}</span>`
      : `<span class="sender-pubkey" data-nip05-target="true" data-pubkey="${pubkey}">${displayIdentifier}</span>`;
  }

  #createReferenceComponent({ reference }) {
    if (!reference) return "";

    try {
      const getLinkUrl = this.#getReferenceUrl(reference);
      const content = this.#getReferenceContent(reference);

      return `
        <div class="zap-reference">
          <div class="reference-icon">
            <img src="${arrowRightIcon}" alt="Reference" width="16" height="16" />
          </div>
          <div class="reference-content">
            <div class="reference-text">${escapeHTML(content)}</div>
            <a href="${getLinkUrl}" target="_blank" class="reference-link">
              <img src="${quickReferenceIcon}" alt="Quick Reference" width="16" height="16" />
            </a>
          </div>
        </div>
      `;
    } catch (error) {
      console.error("Failed to create reference component:", error);
      return "";
    }
  }

  #getReferenceUrl(reference) {
    if (reference.kind === 31990) {
      const rTags = reference.tags.filter((t) => t[0] === "r");
      const nonSourceTag = rTags.find((t) => !t.includes("source")) || rTags[0];
      return nonSourceTag?.[1];
    }
    return `https://njump.me/${encodeNevent(
      reference.id,
      reference.kind,
      reference.pubkey
    )}`;
  }

  #getReferenceContent(reference) {
    const kindContentMap = {
      30023: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30030: () => reference.tags.find((t) => t[0] === "title")?.[1] || reference.content,
      30009: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      40: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      41: () => reference.tags.find((t) => t[0] === "name")?.[1] || reference.content,
      31990: () => reference.tags.find((t) => t[0] === "alt")?.[1] || reference.content,
    };

    return kindContentMap[reference.kind]?.() || reference.content;
  }

  #createZapHTML(zapInfo) {
    const {
      iconComponent,
      nameComponent,
      pubkeyComponent,
      referenceComponent,
    } = this.#createUIComponents(zapInfo);
    const [amount, unit] = zapInfo.satsText.split(" ");
    const isNew = isWithin24Hours(zapInfo.created_at);

    return `
      <div class="zap-sender${zapInfo.comment ? " with-comment" : ""}" data-pubkey="${zapInfo.pubkey}">
        <div class="sender-icon${isNew ? " is-new" : ""}">
          ${iconComponent}
        </div>
        <div class="sender-info">
          ${nameComponent}
          ${pubkeyComponent}
        </div>
        <div class="zap-amount"><span class="number">${amount}</span> ${unit}</div>
      </div>
      ${
        zapInfo.comment
          ? `<div class="zap-details"><span class="zap-comment">${escapeHTML(
              zapInfo.comment
            )}</span></div>`
          : ""
      }
      ${referenceComponent}
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
