import { profileManager } from "./ProfileManager.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon.svg";
import {
  formatNumber,
  formatIdentifier,
  parseZapEvent,
  getProfileDisplayName,
  parseDescriptionTag,
  isWithin24Hours,
  preloadImage,
  escapeHTML,
} from "./utils.js";
import { APP_CONFIG } from "./index.js";

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

  // Profile-related methods
  async #updateZapDisplay(pubkey, zapInfo) {
    const elements = this.shadowRoot.querySelectorAll(`[data-pubkey="${pubkey}"]`);
    elements.forEach(el => {
      const zapItem = el.closest('.zap-list-item');
      if (zapItem) {
        const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
        zapItem.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
        zapItem.innerHTML = this.#createZapHTML(zapInfo);
      }
    });
  }

  async #extractZapInfo(event) {
    const { pubkey, content, satsText } = await parseZapEvent(event, defaultIcon);
    const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);
    
    // 基本情報のみを含む初期データ
    return {
      satsText,
      satsAmount,
      comment: content || "",
      pubkey: pubkey || "",
      created_at: event.created_at,
      displayIdentifier: formatIdentifier(window.NostrTools.nip19.npubEncode(pubkey)),
      senderName: "anonymous",
      senderIcon: defaultIcon,
    };
  }

  async #loadProfileAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const [profile] = await profileManager.fetchProfiles([pubkey]);
      if (!profile) return;

      const senderName = getProfileDisplayName(profile) || "nameless";
      // アイコン画像のプリロードを待つ
      const senderIcon = profile.picture ? await preloadImage(profile.picture) : defaultIcon;
      
      // プロフィール情報を更新
      const nameElement = element.querySelector('.sender-name');
      const iconContainer = element.querySelector('.sender-icon');
      const pubkeyElement = element.querySelector('.sender-pubkey');
      
      if (nameElement) nameElement.textContent = senderName;
      if (iconContainer) {
        // 常にimg要素を使用し、デフォルトアイコンをフォールバックとして設定
        iconContainer.innerHTML = `<img src="${senderIcon}" alt="${escapeHTML(senderName)}'s icon" loading="lazy" onerror="this.src='${defaultIcon}'" />`;
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
      const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
      
      placeholder.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
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
      const zapInfoPromises = sortedZaps.map(async event => {
        const zapInfo = await this.#extractZapInfo(event);
        const li = document.createElement("li");
        const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
        
        li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
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

  async #getDisplayIdentifier(pubkey) {
    if (pubkey && profileManager) {
      const nip05 = await profileManager.verifyNip05Async(pubkey);
      if (nip05) {
        return nip05;
      } else {
        return formatIdentifier(window.NostrTools.nip19.npubEncode(pubkey));
      }
    }
    return "unknown";
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
    satsAmount,
    comment,
    pubkey,
    created_at,
    displayIdentifier,
  }) {
    const [amount, unit] = satsText.split(" ");
    const isNew = isWithin24Hours(created_at);
    const escapedName = escapeHTML(senderName);
    const escapedComment = escapeHTML(comment);
    const colorClass = this.#getAmountColorClass(satsAmount);

    // 常にimg要素を使用
    const iconHTML = `<img src="${senderIcon}" alt="${escapedName}'s icon" loading="lazy" onerror="this.src='${defaultIcon}'" />`;

    return `
      <div class="zap-sender${comment ? " with-comment" : ""}">
        <div class="sender-icon${isNew ? " is-new" : ""}">
          ${iconHTML}
        </div>
        <div class="sender-info">
          <span class="sender-name">${escapedName}</span>
          <span class="sender-pubkey" data-pubkey="${pubkey}">${displayIdentifier}</span>
        </div>
        <div class="zap-amount"><span class="number">${amount}</span> ${unit}</div>
      </div>
      ${
        comment
          ? `<div class="zap-details"><span class="zap-comment">${escapedComment}</span></div>`
          : ""
      }
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

    await this.#prefetchProfiles([event]);

    const zapInfo = await this.#extractZapInfo(event);
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    const li = document.createElement("li");
    li.className = `zap-list-item ${colorClass}${
      zapInfo.comment ? " with-comment" : ""
    }`;
    li.innerHTML = this.#createZapHTML(zapInfo);
    list.prepend(li);
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
          const identifier = fetchButton.getAttribute("data-nzv-identifier");
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
            <div class="zap-placeholder-icon skeleton"></div>
            <div class="zap-placeholder-content">
              <div class="zap-placeholder-name skeleton"></div>
            </div>
            <div class="zap-placeholder-amount skeleton"></div>
          </div>
          <div class="zap-placeholder-details">
            <div class="zap-placeholder-comment skeleton"></div>
          </div>
        </li>
      `
      )
      .join("");
  }

  initializeZapStats() {
    const dialog = this.#getElement(".dialog");
    const statsDiv = this.#getElement(".zap-stats");
    if (!dialog || !statsDiv) return;

    statsDiv.innerHTML = `
      <div class="stats-item">Total Count</div>
      <div class="stats-item"><span class="number skeleton stats-skeleton"></span></div>
      <div class="stats-item">times</div>
      <div class="stats-item">Total Amount</div>
      <div class="stats-item"><span class="number skeleton stats-skeleton"></span></div>
      <div class="stats-item">sats</div>
      <div class="stats-item">Max Amount</div>
      <div class="stats-item"><span class="number skeleton stats-skeleton"></span></div>
      <div class="stats-item">sats</div>
    `;
  }

  displayZapStats(stats) {
    const statsDiv = this.#getElement(".zap-stats");
    if (!statsDiv) return;

    statsDiv.innerHTML = this.#UIComponents.createZapStats(stats);
  }

  // Method to prefetch profile information
  async #prefetchProfiles(sortedZaps) {
    const pubkeys = [
      ...new Set(
        sortedZaps
          .map((event) => parseDescriptionTag(event).pubkey)
          .filter(Boolean)
      ),
    ];

    if (pubkeys.length > 0) {
      // Fetch profile information
      this.profileManager = {
        profiles: new Map(),
        async init(pubkeys) {
          const profiles = await profileManager.fetchProfiles(pubkeys);
          profiles.forEach((profile, index) => {
            this.profiles.set(pubkeys[index], profile);
          });
        },
        getProfile(pubkey) {
          return this.profiles.get(pubkey);
        },
        async verifyNip05(pubkey) {
          return await profileManager.verifyNip05Async(pubkey);
        },
      };
      await this.profileManager.init(pubkeys);
      await Promise.all(
        pubkeys.map((pubkey) => this.#updateDisplayIdentifier(pubkey))
      );
    }
  }

  async #updateDisplayIdentifier(pubkey) {
    if (!pubkey) return;
    try {
      const nip05 = await profileManager.verifyNip05Async(pubkey);
      if (nip05) {
        const elements = this.shadowRoot.querySelectorAll(
          `[data-pubkey="${pubkey}"]`
        );
        elements.forEach((el) => {
          if (!el.hasAttribute("data-nip05-updated")) {
            el.textContent = nip05;
            el.setAttribute("data-nip05-updated", "true");
          }
        });
      }
    } catch (error) {
      console.debug(`NIP-05 verification error (${pubkey}):`, error);
    }
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

  // Profileロジックを分離
  #profileManager = {
    profiles: new Map(),
    async init(pubkeys) {
      const profiles = await profileManager.fetchProfiles(pubkeys);
      this.profiles = new Map(
        profiles.map((profile, index) => [pubkeys[index], profile])
      );
    },
    getProfile(pubkey) {
      return this.profiles.get(pubkey);
    },
    async verifyNip05(pubkey) {
      return await profileManager.verifyNip05Async(pubkey);
    },
  };

  // UI Components
  #UIComponents = {
    createNoZapsMessage: () => `
      <div class="no-zaps-message">
        No Zaps yet!<br>Send the first Zap!
      </div>
    `,

    createPlaceholder: (index) => `
      <li class="zap-list-item" data-index="${index}">
        <div class="zap-sender">
          <div class="zap-placeholder-icon skeleton"></div>
          <div class="zap-placeholder-content">
            <div class="zap-placeholder-name skeleton"></div>
          </div>
          <div class="zap-placeholder-amount skeleton"></div>
        </div>
        <div class="zap-placeholder-details">
          <div class="zap-placeholder-comment skeleton"></div>
        </div>
      </li>
    `,

    createZapStats: (stats) => {
      if (stats.timeout) {
        return this.#createTimeoutStats();
      }
      return this.#createNormalStats(stats);
    },
  };

  #createTimeoutStats() {
    return `
      <div class="stats-item">Total Count</div>
      <div class="stats-item"><span class="number text-muted">nostr.band</span></div>
      <div class="stats-item">times</div>
      <div class="stats-item">Total Amount</div>
      <div class="stats-item"><span class="number text-muted">Stats</span></div>
      <div class="stats-item">sats</div>
      <div class="stats-item">Max Amount</div>
      <div class="stats-item"><span class="number text-muted">Unavailable</span></div>
      <div class="stats-item">sats</div>
    `;
  }

  #createNormalStats(stats) {
    return `
      <div class="stats-item">Total Count</div>
      <div class="stats-item"><span class="number">${formatNumber(
        stats.count
      )}</span></div>
      <div class="stats-item">times</div>
      <div class="stats-item">Total Amount</div>
      <div class="stats-item"><span class="number">${formatNumber(
        Math.floor(stats.msats / 1000)
      )}</span></div>
      <div class="stats-item">sats</div>
      <div class="stats-item">Max Amount</div>
      <div class="stats-item"><span class="number">${formatNumber(
        Math.floor(stats.maxMsats / 1000)
      )}</span></div>
      <div class="stats-item">sats</div>
    `;
  }

  // Style Management
  #styleManager = {
    getAmountColorClass: (amount, isColorModeEnabled) => {
      if (!isColorModeEnabled) return "";

      const thresholds = [
        [10000, "zap-amount-10k"],
        [5000, "zap-amount-5k"],
        [2000, "zap-amount-2k"],
        [1000, "zap-amount-1k"],
        [500, "zap-amount-500"],
        [200, "zap-amount-200"],
        [100, "zap-amount-100"],
      ];

      for (const [threshold, className] of thresholds) {
        if (amount >= threshold) return className;
      }
      return "";
    },

    applyTheme: (root, theme) => {
      const themeClass = theme === "dark" ? "dark-theme" : "light-theme";
      root.classList.add(themeClass);
    },
  };

  // Event Handlers
  #setupEventHandlers() {
    const dialog = this.#getElement(".dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) this.closeDialog();
    });
  }
}

customElements.define("nostr-zap-view-dialog", NostrZapViewDialog);

// Simplified external API
export const createDialog = (viewId) => {
  if (
    !document.querySelector(`nostr-zap-view-dialog[data-view-id="${viewId}"]`)
  ) {
    const dialog = document.createElement("nostr-zap-view-dialog");
    dialog.setAttribute("data-view-id", viewId);
    document.body.appendChild(dialog);
  }
};

// UIの操作関数を修正してviewIdを使用
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
    document.querySelector(`nostr-zap-view-dialog[data-view-id="${viewId}"]`);

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
    prependZap: (event, viewId) => getDialog(viewId)?.prependZap(event),
    displayZapStats: (stats, viewId) =>
      getDialog(viewId)?.displayZapStats(stats),
    showNoZapsMessage: (viewId) => getDialog(viewId)?.showNoZapsMessage(),
  };
})();
