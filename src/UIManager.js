import { profileManager } from "./ProfileManager.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon.svg";
import arrowRightIcon from "./assets/arrow_right.svg"; // 追加
import quickReferenceIcon from "./assets/link.svg"; // 追加
import {
  formatIdentifier,
  parseZapEvent,
  getProfileDisplayName,
  isWithin24Hours,
  escapeHTML,
  isEventIdentifier, // 追加
} from "./utils.js";
import { APP_CONFIG } from "./index.js";
import { UIStatus } from "./UIStatus.js";

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
    this.uiStatus = null;
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
    this.uiStatus = new UIStatus(this.shadowRoot);
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

  async #extractZapInfo(event) {
    try {
      const { pubkey, content, satsText } = await parseZapEvent(event, defaultIcon);
      const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
  
      // pubkeyの存在確認と型チェック
      const normalizedPubkey = typeof pubkey === 'string' ? pubkey : null;
      const displayIdentifier = normalizedPubkey 
        ? formatIdentifier(window.NostrTools.nip19.npubEncode(normalizedPubkey))
        : 'anonymous';
  
      return {
        satsText,
        satsAmount,
        comment: content || "",
        pubkey: normalizedPubkey || "",
        created_at: event.created_at,
        displayIdentifier,
        senderName: null, // nullに変更: 初期表示時はスケルトンを表示
        senderIcon: null, // nullに変更: 初期表示時はスケルトンを表示
      };
    } catch (error) {
      console.error("Failed to extract zap info:", error);
      return {
        satsText: "Amount: Unknown",
        satsAmount: 0,
        comment: "",
        pubkey: "",
        created_at: event.created_at,
        displayIdentifier: "anonymous",
        senderName: "anonymous",
        senderIcon: defaultIcon,
      };
    }
  }

  async #loadProfileAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const [profile] = await profileManager.fetchProfiles([pubkey]);
      if (!profile) return;

      const senderName = getProfileDisplayName(profile) || "nameless";
      const senderIcon = profile.picture || defaultIcon;

      // プロフィール情報を更新
      const nameElement = element.querySelector(".sender-name");
      const nameContainer = element.querySelector(".zap-placeholder-name");
      const iconContainer = element.querySelector(".sender-icon");
      const pubkeyElement = element.querySelector(".sender-pubkey");

      // 名前の更新: スケルトンがある場合は置き換え、ない場合は直接更新
      if (nameContainer) {
        nameContainer.replaceWith(Object.assign(document.createElement("span"), {
          className: "sender-name",
          textContent: senderName
        }));
      } else if (nameElement) {
        nameElement.textContent = senderName;
      }

      if (iconContainer) {
        // スケルトンを削除して画像を追加
        const skeleton = iconContainer.querySelector('.zap-placeholder-icon');
        if (skeleton) {
          skeleton.remove();
          const img = document.createElement('img');
          img.src = senderIcon;
          img.alt = `${escapeHTML(senderName)}'s icon`;
          img.loading = "lazy";
          img.onerror = () => { img.src = defaultIcon; };
          iconContainer.appendChild(img);
        }
      }

      // NIP-05の取得と更新
      const nip05 = await profileManager.verifyNip05Async(pubkey);
      if (nip05 && pubkeyElement) {
        pubkeyElement.textContent = nip05;
        pubkeyElement.setAttribute("data-nip05-updated", "true");
      }
    } catch (error) {
      console.debug("Failed to load profile:", error);
    }
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!placeholder) return;

    try {
      // 基本情報を即時表示
      const zapInfo = await this.#extractZapInfo(event);
      // イベントから参照情報を取得
      zapInfo.reference = event.reference; // この行を追加

      const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);

      placeholder.className = `zap-list-item ${colorClass}${
        zapInfo.comment ? " with-comment" : ""
      }`;
      placeholder.setAttribute("data-pubkey", zapInfo.pubkey);
      placeholder.innerHTML = this.#createZapHTML(zapInfo);

      // プロフィール情報を非同期で更新
      if (zapInfo.pubkey) {
        this.#loadProfileAndUpdate(zapInfo.pubkey, placeholder);
      }
    } catch (error) {
      console.error("Failed to replace placeholder:", error);
    }
  }

  async renderZapListFromCache(zapEventsCache, maxCount) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    try {
      const sortedZaps = [...zapEventsCache]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, maxCount);

      // 基本情報のみで表示を即時更新
      const fragment = document.createDocumentFragment();
      const zapInfoPromises = sortedZaps.map(async (event) => {
        const zapInfo = await this.#extractZapInfo(event);
        // イベントから参照情報を取得
        zapInfo.reference = event.reference; // この行を追加

        const li = document.createElement("li");
        const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);

        li.className = `zap-list-item ${colorClass}${
          zapInfo.comment ? " with-comment" : ""
        }`;
        li.setAttribute("data-pubkey", zapInfo.pubkey);
        li.innerHTML = this.#createZapHTML(zapInfo);

        fragment.appendChild(li);
        return { li, pubkey: zapInfo.pubkey };
      });

      // DOMを一括更新
      const zapElements = await Promise.all(zapInfoPromises);
      list.innerHTML = "";
      list.appendChild(fragment);

      // プロフィール情報を非同期で更新
      zapElements.forEach(({ li, pubkey }) => {
        if (pubkey) {
          this.#loadProfileAndUpdate(pubkey, li);
        }
      });
    } catch (error) {
      console.error("Failed to render zap list:", error);
    }
  }

  #getAmountColorClass(amount) {
    if (!this.#isColorModeEnabled()) return "";

    const thresholds = [
      { value: 10000, className: "zap-amount-10k" },
      { value: 5000, className: "zap-amount-5k" },
      { value: 2000, className: "zap-amount-2k" },
      { value: 1000, className: "zap-amount-1k" },
      { value: 500, className: "zap-amount-500" },
      { value: 200, className: "zap-amount-200" },
      { value: 100, className: "zap-amount-100" },
    ];

    for (const threshold of thresholds) {
      if (amount >= threshold.value) return threshold.className;
    }
    return "";
  }

  #isColorModeEnabled() {
    // Fix: Get the correct button for this dialog using viewId
    const viewId = this.getAttribute("data-view-id");
    const button = document.querySelector(
      `button[data-zap-view-id="${viewId}"]`
    );
    const colorModeAttr = button?.getAttribute("data-zap-color-mode");
    return !colorModeAttr || !["true", "false"].includes(colorModeAttr)
      ? APP_CONFIG.DEFAULT_OPTIONS.colorMode
      : colorModeAttr === "true";
  }

  // UI element creation methods
  #createZapHTML({
    senderName,
    senderIcon,
    satsText,
    comment,
    pubkey,
    created_at,
    displayIdentifier,
    reference, // Add reference parameter
  }) {
    const [amount, unit] = satsText.split(" ");
    const isNew = isWithin24Hours(created_at);
    const escapedName = senderName ? escapeHTML(senderName) : null;
    const escapedComment = escapeHTML(comment);

    // アイコンの表示: senderIconがnullの場合はスケルトンを表示
    const iconHTML = senderIcon
      ? `<img src="${senderIcon}" alt="${escapedName || 'anonymous'}'s icon" loading="lazy" onerror="this.src='${defaultIcon}'">`
      : `<div class="zap-placeholder-icon skeleton"></div>`;

    // 名前の表示: senderNameがnullの場合はスケルトンを表示
    const nameHTML = senderName
      ? `<span class="sender-name">${escapedName}</span>`
      : `<div class="zap-placeholder-name skeleton"></div>`;

    // リンクURLを取得する関数を追加
    const getLinkUrl = (reference) => {
      if (reference.kind === 31990) {
        const rTags = reference.tags.filter((t) => t[0] === "r");
        const nonSourceTag =
          rTags.find((t) => !t.includes("source")) || rTags[0];
        return nonSourceTag?.[1];
      }
      return `https://njump.me/${window.NostrTools.nip19.neventEncode({
        id: reference.id,
        kind: reference.kind,
        pubkey: reference.pubkey,
      })}`;
    };

    // viewIdからidentifierを取得
    const viewId = this.getAttribute("data-view-id");
    const fetchButton = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
    const identifier = fetchButton?.getAttribute("data-nzv-id") || "";
    const shouldShowReference = !isEventIdentifier(identifier);

    // note1やnevent1の場合はreferenceHTMLを生成しない
    const referenceHTML = reference && shouldShowReference
      ? `
      <div class="zap-reference">
        <div class="reference-icon">
          <img src="${arrowRightIcon}" alt="Reference" width="16" height="16" />
        </div>
        <div class="reference-content">
          <div class="reference-text">${
            reference.kind === 30023 || reference.kind === 30030
              ? escapeHTML(
                  reference.tags.find((t) => t[0] === "title")?.[1] ||
                    reference.content
                )
              : reference.kind === 30009 ||
                reference.kind === 40 ||
                reference.kind === 41
              ? escapeHTML(
                  reference.tags.find((t) => t[0] === "name")?.[1] ||
                    reference.content
                )
              : reference.kind === 31990
              ? escapeHTML(
                  reference.tags.find((t) => t[0] === "alt")?.[1] ||
                    reference.content
                )
              : escapeHTML(reference.content)
          }</div>
          <a href="${getLinkUrl(
            reference
          )}" target="_blank" class="reference-link">
            <img src="${quickReferenceIcon}" alt="Quick Reference" width="16" height="16" />
          </a>
        </div>
      </div>
    `
      : "";

    // referenceの有無でnip05とreferenceを区別して表示
    const pubkeyDisplay = reference && shouldShowReference
      ? `<span class="sender-pubkey" data-pubkey="${pubkey}">${displayIdentifier}</span>`
      : `<span class="sender-pubkey" data-nip05-target="true" data-pubkey="${pubkey}">${displayIdentifier}</span>`;

    return `
      <div class="zap-sender${comment ? " with-comment" : ""}">
        <div class="sender-icon${isNew ? " is-new" : ""}">
          ${iconHTML}
        </div>
        <div class="sender-info">
          ${nameHTML}
          ${pubkeyDisplay}
        </div>
        <div class="zap-amount"><span class="number">${amount}</span> ${unit}</div>
      </div>
      ${
        comment
          ? `<div class="zap-details"><span class="zap-comment">${escapedComment}</span></div>`
          : ""
      }
      ${referenceHTML}
    `;
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
      const zapInfo = await this.#extractZapInfo(event);
      // referenceを追加
      zapInfo.reference = event.reference;

      const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
      const li = document.createElement("li");
      li.className = `zap-list-item ${colorClass}${
        zapInfo.comment ? " with-comment" : ""
      }`;
      li.setAttribute("data-pubkey", zapInfo.pubkey);
      li.innerHTML = this.#createZapHTML(zapInfo);

      list.prepend(li);

      // プロフィール情報を非同期で更新
      if (zapInfo.pubkey) {
        this.#loadProfileAndUpdate(zapInfo.pubkey, li);
      }
    } catch (error) {
      console.error("Failed to prepend zap:", error);
    }
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
          title.textContent = "To " + formatIdentifier(identifier);
          title.classList.remove("custom-title");
        }
      }
      dialog.showModal();
    }
  }

  closeDialog() {
    const dialog = this.#getElement(".dialog");
    if (dialog?.open) dialog.close();
  }

  // Zap display methods
  initializeZapPlaceholders(maxCount) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    // viewIdからidentifierを取得
    const viewId = this.getAttribute("data-view-id");
    const fetchButton = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
    const identifier = fetchButton?.getAttribute("data-nzv-id") || "";
    const shouldShowReference = !isEventIdentifier(identifier);

    list.innerHTML = Array(maxCount)
      .fill(null)
      .map(
        (_, i) => `
        <li class="zap-list-item" data-index="${i}">
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
          <div class="zap-details">
            <div class="zap-placeholder-comment skeleton"></div>
          </div>
          ${shouldShowReference ? `
          <div class="zap-reference">
            <div class="reference-icon skeleton"></div>
            <div class="reference-content">
              <div class="reference-text skeleton"></div>
              <div class="reference-link skeleton"></div>
            </div>
          </div>
          ` : ''}
        </li>
      `
      )
      .join("");
  }

  initializeZapStats() {
    this.uiStatus.initializeStats();
  }

  displayZapStats(stats) {
    this.uiStatus.displayStats(stats);
  }

  showNoZapsMessage() {
    this.uiStatus.showNoZaps();
  }

  #createNoZapsMessage() {
    return `
      <div class="no-zaps-message">
        No Zaps yet!<br>Send the first Zap!
      </div>
    `;
  }

  showNoZapsMessage() {
    const list = this.#getElement(".dialog-zap-list");
    if (list) {
      list.innerHTML = this.#createNoZapsMessage();
    }
  }
}

customElements.define("nzv-dialog", NostrZapViewDialog);

// Simplified external API
export const createDialog = (viewId) => {
  if (
    !document.querySelector(`nzv-dialog[data-view-id="${viewId}"]`)
  ) {
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
  showNoZapsMessage, // ここに統合
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
    renderZapListFromCache: (cache, max, viewId) =>
      getDialog(viewId)?.renderZapListFromCache(cache, max),
    prependZap: (event, viewId) => getDialog(viewId)?.prependZap(event, viewId),
    displayZapStats: (stats, viewId) =>
      getDialog(viewId)?.displayZapStats(stats),
    showNoZapsMessage: (viewId) => getDialog(viewId)?.showNoZapsMessage(),
  };
})();
