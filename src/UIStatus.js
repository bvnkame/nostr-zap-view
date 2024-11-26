import { formatNumber } from "./utils.js";

export class UIStatus {
  constructor(rootElement) {
    this.root = rootElement;
  }

  initializeStats() {
    const statsDiv = this.root.querySelector(".zap-stats");
    if (!statsDiv) return;

    // デフォルトのスケルトン表示を行う
    this.#showSkeletonStats(statsDiv);

    // タイムアウト用のタイマーを設定
    setTimeout(() => {
      // まだスケルトン表示が残っている場合はタイムアウト表示に切り替え
      if (statsDiv.querySelector('.stats-skeleton')) {
        statsDiv.innerHTML = this.#createTimeoutStats();
      }
    }, 4000); // 10秒後にタイムアウト
  }

  displayStats(stats) {
    const statsDiv = this.root.querySelector(".zap-stats");
    if (!statsDiv) return;

    // エラー状態とタイムアウト状態の判定を厳密に行う
    const isTimeout = !stats || 
                     (stats.error === true && stats.timeout === true) || 
                     (!stats.hasOwnProperty('count') && !stats.hasOwnProperty('msats'));

    statsDiv.innerHTML = isTimeout
      ? this.#createTimeoutStats()
      : this.#createNormalStats(stats);
  }

  showNoZaps() {
    const list = this.root.querySelector(".dialog-zap-list");
    if (list) {
      list.innerHTML = this.#createNoZapsMessage();
    }
  }

  #showSkeletonStats(statsDiv) {
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

  #createNoZapsMessage() {
    return `
      <div class="no-zaps-message">
        No Zaps yet!<br>Send the first Zap!
      </div>
    `;
  }
}