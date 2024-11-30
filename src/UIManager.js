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
      const reference = this.event.reference || this.#extractReferenceFromTags();

      return {
        satsText,
        satsAmount,
        comment: content || "",
        pubkey: normalizedPubkey || "",
        created_at: this.event.created_at,
        displayIdentifier: normalizedPubkey
          ? formatIdentifier(
              window.NostrTools.nip19.npubEncode(normalizedPubkey)
            )
          : "anonymous",
        senderName: null,
        senderIcon: null,
        reference,
      };
    } catch (error) {
      console.error("Failed to extract zap info:", error, this.event);
      return this.#createDefaultInfo();
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
    const zapInfo = new ZapInfo(event, defaultIcon);
    const info = await zapInfo.extractInfo();
    return info; // 修正: referenceを再設定せず、そのまま返す
  }

  async #loadProfileAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const [profile] = await profileManager.fetchProfiles([pubkey]);
      if (!profile) return;

      const senderName = getProfileDisplayName(profile) || "nameless";
      const senderIcon = profile.picture || defaultIcon;

      // 名前の更新
      const nameElement = element.querySelector(".sender-name");
      const nameContainer = element.querySelector(".zap-placeholder-name");
      if (nameContainer) {
        nameContainer.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "sender-name",
            textContent: senderName,
          })
        );
      } else if (nameElement) {
        nameElement.textContent = senderName;
      }

      // アイコンの非同期読み込み
      if (senderIcon !== defaultIcon) {
        const iconContainer = element.querySelector(".sender-icon");
        if (iconContainer) {
          const img = new Image();
          img.onload = () => {
            const skeleton = iconContainer.querySelector(".zap-placeholder-icon");
            if (skeleton) {
              skeleton.remove();
              img.className = "profile-icon";
              img.alt = `${escapeHTML(senderName)}'s icon`;
              img.loading = "lazy";
              iconContainer.appendChild(img);
            }
          };
          img.onerror = () => {
            const skeleton = iconContainer.querySelector(".zap-placeholder-icon");
            if (skeleton) {
              skeleton.remove();
              const defaultImg = document.createElement("img");
              defaultImg.src = defaultIcon;
              defaultImg.alt = `${escapeHTML(senderName)}'s icon`;
              defaultImg.loading = "lazy";
              iconContainer.appendChild(defaultImg);
            }
          };
          img.src = senderIcon;
        }
      } else {
        // デフォルトアイコンの即時表示
        const iconContainer = element.querySelector(".sender-icon");
        const skeleton = iconContainer?.querySelector(".zap-placeholder-icon");
        if (skeleton) {
          skeleton.remove();
          const defaultImg = document.createElement("img");
          defaultImg.src = defaultIcon;
          defaultImg.alt = `${escapeHTML(senderName)}'s icon`;
          defaultImg.loading = "lazy";
          iconContainer.appendChild(defaultImg);
        }
      }

      // NIP-05の非同期取得と更新
      const pubkeyElement = element.querySelector(".sender-pubkey");
      if (pubkeyElement && !pubkeyElement.getAttribute("data-nip05-updated")) {
        profileManager.verifyNip05Async(pubkey).then(nip05 => {
          if (nip05) {
            pubkeyElement.textContent = nip05;
            pubkeyElement.setAttribute("data-nip05-updated", "true");
          }
        });
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
      // zapInfo.reference = event.reference; // この行を削除

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
        // zapInfo.reference = event.reference; // この行を削除

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
      // zapInfo.reference = event.reference; // この行を削除

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
    return senderIcon
      ? `<img src="${senderIcon}" alt="${escapeHTML(
          senderName || "anonymous"
        )}'s icon" loading="lazy" onerror="this.src='${defaultIcon}'">`
      : `<div class="zap-placeholder-icon skeleton"></div>`;
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
    return `https://njump.me/${window.NostrTools.nip19.neventEncode({
      id: reference.id,
      kind: reference.kind,
      pubkey: reference.pubkey,
    })}`;
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
      <div class="zap-sender${zapInfo.comment ? " with-comment" : ""}">
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
    renderZapListFromCache: async (cache, max, viewId) => {
      const dialog = getDialog(viewId);
      if (!dialog) return;

      console.log('[UIManager] キャッシュからの表示開始:', {
        cacheSize: cache.length,
        maxDisplay: max,
        viewId
      });

      const list = dialog.shadowRoot.querySelector(".dialog-zap-list");
      if (!list) return;
      list.innerHTML = "";

      // キャッシュからデータを即時表示
      const sortedZaps = [...cache]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, max);

      console.log('[UIManager] 表示するZaps:', {
        count: sortedZaps.length,
        ids: sortedZaps.map(zap => zap.id)
      });

      if (sortedZaps.length === 0) {
        dialog.showNoZapsMessage();
        return;
      }

      await dialog.renderZapListFromCache(sortedZaps, max);
    },
    prependZap: (event, viewId) => getDialog(viewId)?.prependZap(event, viewId),
    displayZapStats: (stats, viewId) =>
      getDialog(viewId)?.displayZapStats(stats),
    showNoZapsMessage: (viewId) => getDialog(viewId)?.showNoZapsMessage(),
  };
})();
