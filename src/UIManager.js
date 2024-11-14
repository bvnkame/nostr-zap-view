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

  // ライフサイクルメソッド
  connectedCallback() {
    this.#initializeDialog();
  }

  // 初期化関連メソッド
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
      <dialog id="zapDialog">
        <h2 id="dialogTitle"></h2>
        <button id="closeDialogButton">X</button>
        <div class="zap-stats"></div>
        <ul id="dialogZapList"></ul>
      </dialog>
    `;
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  #setupEventListeners() {
    const dialog = this.#getElement("#zapDialog");
    const closeButton = this.#getElement("#closeDialogButton");

    closeButton.addEventListener("click", () => this.closeDialog());

    // クリックイベントにsetTimeoutを追加して、
    // DOMの更新が完了した後に判定を行う
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        setTimeout(() => {
          // ダイアログの範囲チェックを再度行う
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            this.closeDialog();
          }
        }, 0);
      }
    });
  }

  // プロフィール関連メソッド
  async #extractZapInfo(event) {
    const { pubkey, content, satsText } = await parseZapEvent(event, defaultIcon);
    const satsAmount = parseInt(satsText.replace(/,/g, "").split(" ")[0], 10);

    let senderName = "anonymous";
    let senderIcon = "";

    if (pubkey && this.profileManager) {
      const profile = this.profileManager.getProfile(pubkey);
      if (profile) {
        senderName = getProfileDisplayName(profile);
        if (!senderName) {
          senderName = "nameless";
        }
        if (profile.picture) {
          senderIcon = (await preloadImage(profile.picture)) || defaultIcon;
        } else {
          senderIcon = defaultIcon;
        }
      }
    } else {
      senderIcon = defaultIcon;
    }

    return {
      senderName,
      senderIcon,
      satsText,
      satsAmount,
      comment: content || "",
      pubkey: pubkey || "",
      created_at: event.created_at,
    };
  }

  #getAmountColorClass(amount) {
    const button = document.querySelector("button[data-identifier]");
    const colorModeAttr = button?.getAttribute("data-zap-color-mode");
    const isColorModeEnabled = !colorModeAttr || !["true", "false"].includes(colorModeAttr) ? APP_CONFIG.DEFAULT_OPTIONS.colorMode : colorModeAttr === "true";

    if (!isColorModeEnabled) {
      return "";
    }

    let colorClass = "";
    if (amount >= 10000) colorClass = "zap-amount-10k";
    else if (amount >= 5000) colorClass = "zap-amount-5k";
    else if (amount >= 2000) colorClass = "zap-amount-2k";
    else if (amount >= 1000) colorClass = "zap-amount-1k";
    else if (amount >= 500) colorClass = "zap-amount-500";
    else if (amount >= 200) colorClass = "zap-amount-200";
    else if (amount >= 100) colorClass = "zap-amount-100";

    return colorClass;
  }

  // UI要素生成メソッド
  #createZapHTML({ senderName, senderIcon, satsText, satsAmount, comment, pubkey, created_at }) {
    const [amount, unit] = satsText.split(" ");
    const npubKey = pubkey ? formatIdentifier(window.NostrTools.nip19.npubEncode(pubkey)) : "";
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
          <span class="sender-pubkey" data-pubkey="${pubkey}">${npubKey}</span>
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
    const list = this.#getElement("#dialogZapList");
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
    const list = this.#getElement("#dialogZapList");
    if (!list) return;

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

  // 公開API
  showDialog() {
    const dialog = this.#getElement("#zapDialog");
    if (dialog && !dialog.open) {
      const fetchButton = document.querySelector("button[data-identifier]");
      if (fetchButton) {
        const title = this.#getElement("#dialogTitle");
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
    const dialog = this.#getElement("#zapDialog");
    if (dialog?.open) dialog.close();
  }

  // Zap表示関連メソッド
  initializeZapPlaceholders(maxCount) {
    const list = this.#getElement("#dialogZapList");
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
    const dialog = this.#getElement("#zapDialog");
    const statsDiv = this.#getElement(".zap-stats");
    if (!dialog || !statsDiv) return;

    statsDiv.innerHTML = `
      <div class="stats-item"></div>
      <div class="stats-item"></div>
      <div class="stats-item"></div>
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

  // プロフィール情報の事前取得用のメソッドを追加
  async #prefetchProfiles(sortedZaps) {
    const pubkeys = [...new Set(sortedZaps.map((event) => parseDescriptionTag(event).pubkey).filter(Boolean))];

    if (pubkeys.length > 0) {
      this.profileManager = {
        profiles: new Map((await profileManager.fetchProfiles(pubkeys)).map((profile, index) => [pubkeys[index], profile])),
        getProfile: function (pubkey) {
          return this.profiles.get(pubkey);
        },
      };

      // NIP-05検証を非同期で開始
      pubkeys.forEach((pubkey) => {
        if (pubkey) {
          profileManager.verifyNip05Async(pubkey).then((nip05) => {
            if (nip05) {
              const elements = this.shadowRoot.querySelectorAll(`[data-pubkey="${pubkey}"]`);
              elements.forEach((el) => (el.textContent = nip05));
            }
          });
        }
      });
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
    const list = this.#getElement("#dialogZapList");
    if (list) {
      list.innerHTML = this.#createNoZapsMessage();
    }
  }
}

customElements.define("zap-dialog", ZapDialog);

// 外部APIの簡略化
export const createDialog = () => {
  if (!document.querySelector("zap-dialog")) {
    document.body.appendChild(document.createElement("zap-dialog"));
  }
};

export const { closeDialog, showDialog, initializeZapPlaceholders, initializeZapStats, replacePlaceholderWithZap, renderZapListFromCache, prependZap, displayZapStats } = (() => {
  const getDialog = () => document.querySelector("zap-dialog");

  return {
    closeDialog: () => getDialog()?.closeDialog(),
    showDialog: () => getDialog()?.showDialog(),
    initializeZapPlaceholders: (maxCount) => getDialog()?.initializeZapPlaceholders(maxCount),
    initializeZapStats: () => getDialog()?.initializeZapStats(),
    replacePlaceholderWithZap: (event, index) => getDialog()?.replacePlaceholderWithZap(event, index),
    renderZapListFromCache: (cache, max) => getDialog()?.renderZapListFromCache(cache, max),
    prependZap: (event) => getDialog()?.prependZap(event),
    displayZapStats: (stats) => getDialog()?.displayZapStats(stats),
  };
})();

export async function showNoZapsMessage() {
  const dialog = document.querySelector("zap-dialog");
  if (dialog) {
    dialog.showNoZapsMessage();
  }
}
