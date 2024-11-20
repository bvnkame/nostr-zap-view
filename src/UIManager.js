import { profileManager } from "./ProfileManager.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon-purple-on-white.svg";
import { formatNumber, formatIdentifier, parseZapEvent, getProfileDisplayName, parseDescriptionTag, isWithin24Hours, preloadImage, escapeHTML } from "./utils.js";
import { APP_CONFIG } from "./index.js";

class ZapDialog extends HTMLElement {
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
    const themeClass = this.#state.theme === "dark" ? "dark-theme" : "light-theme";
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
      <dialog class="zap-dialog">
        <h2 class="dialog-title"></h2>
        <button class="close-dialog-button">X</button>
        <div class="zap-stats"></div>
        <ul class="dialog-zap-list"></ul>
      </dialog>
    `;
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  #setupEventListeners() {
    const dialog = this.#getElement(".zap-dialog");
    const closeButton = this.#getElement(".close-dialog-button");

    closeButton.addEventListener("click", () => this.closeDialog());
    dialog.addEventListener("click", this.#onDialogClick.bind(this));
  }

  #onDialogClick(event) {
    if (event.target === this.#getElement(".zap-dialog")) {
      this.closeDialog();
    }
  }

  // Profile-related methods
  async #extractZapInfo(event) {
    const { pubkey, content, satsText } = await parseZapEvent(event, defaultIcon);
    const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);

    const senderProfile = await this.#getSenderProfile(pubkey);
    const displayIdentifier = await this.#getDisplayIdentifier(pubkey, senderProfile);

    return {
      ...senderProfile,
      satsText,
      satsAmount,
      comment: content || "",
      pubkey: pubkey || "",
      created_at: event.created_at,
      displayIdentifier,
    };
  }

  async #getSenderProfile(pubkey) {
    let senderName = "anonymous";
    let senderIcon = defaultIcon;

    if (pubkey && this.profileManager) {
      const profile = this.profileManager.getProfile(pubkey);
      if (profile) {
        senderName = getProfileDisplayName(profile) || "nameless";
        senderIcon = (await preloadImage(profile.picture)) || defaultIcon;
      }
    }

    return { senderName, senderIcon };
  }

  async #getDisplayIdentifier(pubkey, profile) {
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
    const isColorModeEnabled = this.#isColorModeEnabled();
    if (!isColorModeEnabled) {
      return "";
    }

    if (amount >= 10000) return "zap-amount-10k";
    if (amount >= 5000) return "zap-amount-5k";
    if (amount >= 2000) return "zap-amount-2k";
    if (amount >= 1000) return "zap-amount-1k";
    if (amount >= 500) return "zap-amount-500";
    if (amount >= 200) return "zap-amount-200";
    if (amount >= 100) return "zap-amount-100";
    return "";
  }

  #isColorModeEnabled() {
    // Fix: Get the correct button for this dialog using viewId
    const viewId = this.getAttribute("data-view-id");
    const button = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
    const colorModeAttr = button?.getAttribute("data-zap-color-mode");
    return !colorModeAttr || !["true", "false"].includes(colorModeAttr) 
      ? APP_CONFIG.DEFAULT_OPTIONS.colorMode 
      : colorModeAttr === "true";
  }

  // UI element creation methods
  #createZapHTML({ senderName, senderIcon, satsText, satsAmount, comment, pubkey, created_at, displayIdentifier }) {
    const [amount, unit] = satsText.split(" ");
    const isNew = isWithin24Hours(created_at);
    const escapedName = escapeHTML(senderName);
    const escapedComment = escapeHTML(comment);
    const colorClass = this.#getAmountColorClass(satsAmount);

    const iconHTML = senderIcon ? `<img src="${senderIcon}" alt="${escapedName}'s icon" loading="lazy" onerror="this.src='${defaultIcon}'">` : `<div class="zap-placeholder-icon"></div>`;

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
      ${comment ? `<div class="zap-details"><span class="zap-comment">${escapedComment}</span></div>` : ""}
    `;
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!placeholder) return;

    await this.#prefetchProfiles([event]);

    const zapInfo = await this.#extractZapInfo(event);
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    placeholder.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    placeholder.innerHTML = this.#createZapHTML(zapInfo);
    placeholder.removeAttribute("data-index");
  }

  async renderZapListFromCache(zapEventsCache, maxCount) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    const sortedZaps = [...zapEventsCache].sort((a, b) => b.created_at - a.created_at).slice(0, maxCount);
    await this.#prefetchProfiles(sortedZaps);

    const fragment = document.createDocumentFragment();
    const zapInfoPromises = sortedZaps.map((event) => this.#extractZapInfo(event));
    const zapInfos = await Promise.all(zapInfoPromises);

    zapInfos.forEach((zapInfo) => {
      const li = document.createElement("li");
      const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
      li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
      li.innerHTML = this.#createZapHTML(zapInfo);
      fragment.appendChild(li);
    });

    list.innerHTML = "";
    list.appendChild(fragment);
  }

  async prependZap(event) {
    const list = this.#getElement(".dialog-zap-list");
    if (!list) return;

    // Remove "No Zaps" message if it exists
    const noZapsMessage = list.querySelector('.no-zaps-message');
    if (noZapsMessage) {
      list.innerHTML = '';
    }

    await this.#prefetchProfiles([event]);

    const zapInfo = await this.#extractZapInfo(event);
    const colorClass = this.#getAmountColorClass(zapInfo.satsAmount);
    const li = document.createElement("li");
    li.className = `zap-list-item ${colorClass}${zapInfo.comment ? " with-comment" : ""}`;
    li.innerHTML = this.#createZapHTML(zapInfo);
    list.prepend(li);
  }

  #getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  // Public API
  showDialog() {
    const dialog = this.#getElement(".zap-dialog");
    if (dialog && !dialog.open) {
      const viewId = this.getAttribute("data-view-id");
      const fetchButton = document.querySelector(`button[data-zap-view-id="${viewId}"]`);
      if (fetchButton) {
        const title = this.#getElement(".dialog-title");
        const customTitle = fetchButton.getAttribute("data-title");
        if (customTitle && customTitle.trim()) {
          title.textContent = customTitle;
          title.classList.add("custom-title");
        } else {
          const identifier = fetchButton.getAttribute("data-identifier");
          title.textContent = "To " + formatIdentifier(identifier);
          title.classList.remove("custom-title");
        }
      }
      dialog.showModal();
    }
  }

  closeDialog() {
    const dialog = this.#getElement(".zap-dialog");
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
    const dialog = this.#getElement(".zap-dialog");
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

    statsDiv.innerHTML = `
      <div class="stats-item">Total Count</div>
      <div class="stats-item"><span class="number">${formatNumber(stats.count)}</span></div>
      <div class="stats-item">times</div>
      <div class="stats-item">Total Amount</div>
      <div class="stats-item"><span class="number">${formatNumber(Math.floor(stats.msats / 1000))}</span></div>
      <div class="stats-item">sats</div>
      <div class="stats-item">Max Amount</div>
      <div class="stats-item"><span class="number">${formatNumber(Math.floor(stats.maxMsats / 1000))}</span></div>
      <div class="stats-item">sats</div>
    `;
  }

  // Method to prefetch profile information
  async #prefetchProfiles(sortedZaps) {
    const pubkeys = [...new Set(sortedZaps.map((event) => parseDescriptionTag(event).pubkey).filter(Boolean))];

    if (pubkeys.length > 0) {
      // Fetch profile information
      const profiles = await profileManager.fetchProfiles(pubkeys);
      this.profileManager = {
        profiles: new Map(profiles.map((profile, index) => [pubkeys[index], profile])),
        getProfile: function (pubkey) {
          return this.profiles.get(pubkey);
        },
      };

      // Verify NIP-05 and update display
      await Promise.all(pubkeys.map(pubkey => this.#updateDisplayIdentifier(pubkey)));
    }
  }

  async #updateDisplayIdentifier(pubkey) {
    if (!pubkey) return;
    try {
      const nip05 = await profileManager.verifyNip05Async(pubkey);
      if (nip05) {
        const elements = this.shadowRoot.querySelectorAll(`[data-pubkey="${pubkey}"]`);
        elements.forEach(el => {
          if (!el.hasAttribute('data-nip05-updated')) {
            el.textContent = nip05;
            el.setAttribute('data-nip05-updated', 'true');
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
}

customElements.define("zap-dialog", ZapDialog);

// Simplified external API
export const createDialog = (viewId) => {
  if (!document.querySelector(`zap-dialog[data-view-id="${viewId}"]`)) {
    const dialog = document.createElement("zap-dialog");
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
  showNoZapsMessage  // ここに統合
} = (() => {
  const getDialog = (viewId) => document.querySelector(`zap-dialog[data-view-id="${viewId}"]`);

  return {
    closeDialog: (viewId) => getDialog(viewId)?.closeDialog(),
    showDialog: (viewId) => getDialog(viewId)?.showDialog(),
    initializeZapPlaceholders: (maxCount, viewId) => getDialog(viewId)?.initializeZapPlaceholders(maxCount),
    initializeZapStats: (viewId) => getDialog(viewId)?.initializeZapStats(),
    replacePlaceholderWithZap: (event, index, viewId) => getDialog(viewId)?.replacePlaceholderWithZap(event, index),
    renderZapListFromCache: (cache, max, viewId) => getDialog(viewId)?.renderZapListFromCache(cache, max),
    prependZap: (event, viewId) => getDialog(viewId)?.prependZap(event),
    displayZapStats: (stats, viewId) => getDialog(viewId)?.displayZapStats(stats),
    showNoZapsMessage: (viewId) => getDialog(viewId)?.showNoZapsMessage(),
  };
})();
