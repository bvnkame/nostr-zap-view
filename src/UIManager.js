import { profileManager } from "./ProfileManager.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon-purple-on-white.svg";
import { formatNumber, formatIdentifier, parseZapEvent, getProfileDisplayName, parseDescriptionTag, parseBolt11 } from "./utils.js";

class ZapDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
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

    let senderName = "Anonymous";
    let senderIcon = defaultIcon;

    if (pubkey) {
      const profile = await this.#getProfileInfo(pubkey);
      senderName = profile.senderName;
      senderIcon = profile.senderIcon;
    }

    return {
      senderName,
      senderIcon,
      satsText,
      comment: content || "",
      pubkey: pubkey || "",
    };
  }

  async #getProfileInfo(pubkey) {
    if (!pubkey) return { senderName: "Anonymous", senderIcon: defaultIcon };

    const profile = profileManager.profileCache.get(pubkey) || (await profileManager.fetchProfile(pubkey));

    return {
      senderName: getProfileDisplayName(profile),
      senderIcon: profile?.picture || defaultIcon,
    };
  }

  // UI要素生成メソッド
  #createZapHTML({ senderName, senderIcon, satsText, comment, pubkey }) {
    const [amount, unit] = satsText.split(" ");
    const npubKey = pubkey ? formatIdentifier(window.NostrTools.nip19.npubEncode(pubkey)) : "";
    return `
      <div class="zap-sender">
        <div class="sender-icon">
          <img src="${senderIcon}" alt="${senderName}'s icon" loading="lazy">
        </div>
        <div class="sender-info">
          <span class="sender-name">${senderName}</span>
          <span class="sender-pubkey">${npubKey}</span>
        </div>
      </div>
      <div class="zap-details">
        <span class="zap-amount"><span class="number">${amount}</span> ${unit}</span>
        ${comment ? `<span class="zap-comment">${comment}</span>` : ""}
      </div>
    `;
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
        const identifier = fetchButton.getAttribute("data-identifier");
        const title = this.#getElement("#dialogTitle");
        title.textContent = "To " + formatIdentifier(identifier);
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
          <div class="zap-placeholder-icon"></div>
          <span>Loading...</span>
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

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.#getElement(`[data-index="${index}"]`);
    if (!placeholder) return;

    const zapInfo = await this.#extractZapInfo(event);
    if (zapInfo) {
      placeholder.innerHTML = this.#createZapHTML(zapInfo);
      placeholder.removeAttribute("data-index");
    }
  }

  async renderZapListFromCache(zapEventsCache, maxCount) {
    const list = this.#getElement("#dialogZapList");
    if (!list) return;

    const sortedZaps = [...zapEventsCache].sort((a, b) => b.created_at - a.created_at).slice(0, maxCount);

    // プロフィール情報の一括取得
    const pubkeys = sortedZaps
      .map((event) => {
        const { pubkey } = parseDescriptionTag(event);
        return pubkey;
      })
      .filter(Boolean);

    await profileManager.fetchProfiles(pubkeys);

    // Zapリストの描画（キャッシュから取得）
    list.innerHTML = "";
    for (const event of sortedZaps) {
      const zapInfo = await this.#extractZapInfo(event);
      const li = document.createElement("li");
      li.classList.add("zap-list-item");
      li.innerHTML = this.#createZapHTML(zapInfo);
      list.appendChild(li);
    }
  }

  async prependZap(event) {
    const list = this.#getElement("#dialogZapList");
    if (!list) return;

    const zapInfo = await this.#extractZapInfo(event);
    const li = document.createElement("li");
    li.classList.add("zap-list-item");
    li.innerHTML = this.#createZapHTML(zapInfo);
    list.prepend(li);
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
