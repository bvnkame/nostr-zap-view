import { profileManager } from "./ProfileManager.js";
import styles from "./styles/styles.css";
import defaultIcon from "./assets/nostr-icon-purple-on-white.svg";
import { formatNumber, formatIdentifier } from "./utils.js";

class ZapDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  // ライフサイクルメソッド
  connectedCallback() {
    this.initializeDialog();
  }

  // 初期化メソッド
  initializeDialog() {
    this.setupStyles();
    this.setupTemplate();
    this.setupEventListeners();
  }

  setupStyles() {
    const styleSheet = document.createElement("style");
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);
  }

  setupTemplate() {
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

  setupEventListeners() {
    const dialog = this.getElement("#zapDialog");
    const closeButton = this.getElement("#closeDialogButton");

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

  // ユーティリティメソッド
  getElement(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  async extractZapInfo(event) {
    const { pubkey, content } = await this.parseDescriptionTag(event);
    const satsText = await this.parseBolt11(event);

    let senderName = "Anonymous";
    let senderIcon = defaultIcon;

    if (pubkey) {
      const profile = await this.getProfileInfo(pubkey);
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

  async parseDescriptionTag(event) {
    const descriptionTag = event.tags.find((tag) => tag[0] === "description")?.[1];
    if (!descriptionTag) return { pubkey: null, content: "" };

    try {
      const parsed = JSON.parse(descriptionTag);
      return { pubkey: parsed.pubkey, content: parsed.content || "" };
    } catch (error) {
      console.error("Description tag parse error:", error);
      return { pubkey: null, content: "" };
    }
  }

  async getProfileInfo(pubkey) {
    if (!pubkey) return { senderName: "Anonymous", senderIcon: defaultIcon };

    // キャッシュから直接取得
    const profile = profileManager.profileCache.get(pubkey);

    if (profile) {
      // キャッシュにプロフィールが存在する場合
      return {
        senderName: profile.display_name || profile.displayName || profile.name || "Anonymous",
        senderIcon: profile.picture || defaultIcon,
      };
    } else {
      // リアルタイムZap用に個別取得
      const fetchedProfile = await profileManager.fetchProfile(pubkey);
      return {
        senderName: fetchedProfile?.display_name || fetchedProfile?.displayName || fetchedProfile?.name || "Anonymous",
        senderIcon: fetchedProfile?.picture || defaultIcon,
      };
    }
  }

  async parseBolt11(event) {
    const bolt11Tag = event.tags.find((tag) => tag[0].toLowerCase() === "bolt11")?.[1];
    if (!bolt11Tag) return "Amount: Unknown";

    try {
      const decoded = window.decodeBolt11(bolt11Tag);
      const amountMsat = decoded.sections.find((section) => section.name === "amount")?.value;
      return amountMsat ? `${formatNumber(Math.floor(amountMsat / 1000))} sats` : "Amount: Unknown";
    } catch (error) {
      console.error("BOLT11 decode error:", error);
      return "Amount: Unknown";
    }
  }

  // 重複していたshowDialogを1つに統合
  showDialog() {
    const dialog = this.getElement("#zapDialog");
    if (dialog && !dialog.open) {
      const fetchButton = document.querySelector("button[data-identifier]");
      if (fetchButton) {
        const identifier = fetchButton.getAttribute("data-identifier");
        const title = this.getElement("#dialogTitle");
        title.textContent = "To " + formatIdentifier(identifier);
      }
      dialog.showModal();
    }
  }

  createZapHTML({ senderName, senderIcon, satsText, comment, pubkey }) {
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

  // 公開メソッド
  closeDialog() {
    const dialog = this.getElement("#zapDialog");
    if (dialog?.open) dialog.close();
  }

  initializeZapPlaceholders(maxCount) {
    const list = this.getElement("#dialogZapList");
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
    const dialog = this.getElement("#zapDialog");
    const statsDiv = this.getElement(".zap-stats");
    if (!dialog || !statsDiv) return;

    statsDiv.innerHTML = `
      <div class="stats-item"></div>
      <div class="stats-item"></div>
      <div class="stats-item"></div>
    `;
  }

  async replacePlaceholderWithZap(event, index) {
    const placeholder = this.getElement(`[data-index="${index}"]`);
    if (!placeholder) return;

    const zapInfo = await this.extractZapInfo(event);
    if (zapInfo) {
      placeholder.innerHTML = this.createZapHTML(zapInfo);
      placeholder.removeAttribute("data-index");
    }
  }

  async renderZapListFromCache(zapEventsCache, maxCount) {
    const list = this.getElement("#dialogZapList");
    if (!list) return;

    const sortedZaps = [...zapEventsCache].sort((a, b) => b.created_at - a.created_at).slice(0, maxCount);

    // 一括でプロフィール情報を取得
    const pubkeys = sortedZaps
      .map((event) => event.tags.find((tag) => tag[0] === "description"))
      .filter((tag) => tag)
      .map((tag) => {
        try {
          const parsed = JSON.parse(tag[1]);
          return parsed.pubkey;
        } catch (e) {
          return null;
        }
      })
      .filter((pubkey) => pubkey);

    // バッチでプロフィール取得
    await profileManager.fetchProfiles(pubkeys);

    // Zapリストの描画（キャッシュから取得）
    list.innerHTML = "";
    for (const event of sortedZaps) {
      const { pubkey, content } = await this.parseDescriptionTag(event);
      const satsText = await this.parseBolt11(event);

      // キャッシュから直接プロフィール情報を取得
      const profile = pubkey ? profileManager.profileCache.get(pubkey) : null;
      const senderName = profile?.display_name || profile?.displayName || profile?.name || "Anonymous";
      const senderIcon = profile?.picture || defaultIcon;

      const zapInfo = {
        senderName,
        senderIcon,
        satsText,
        comment: content || "",
        pubkey: pubkey || "",
      };

      const li = document.createElement("li");
      li.classList.add("zap-list-item");
      li.innerHTML = this.createZapHTML(zapInfo);
      list.appendChild(li);
    }
  }

  async prependZap(event) {
    const list = this.getElement("#dialogZapList");
    if (!list) return;

    const zapInfo = await this.extractZapInfo(event);
    const li = document.createElement("li");
    li.classList.add("zap-list-item");
    li.innerHTML = this.createZapHTML(zapInfo);
    list.prepend(li);
  }

  displayZapStats(stats) {
    const statsDiv = this.getElement(".zap-stats");
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
