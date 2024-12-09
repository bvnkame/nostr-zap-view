import { formatNumber } from "../utils.js";

export class StatusUI {
  constructor(rootElement) {
    this.root = rootElement;
  }

  displayStats(stats) {
    console.time('[StatusUI] Total stats display');
    const statsDiv = this.root.querySelector(".zap-stats");
    if (!statsDiv) {
      console.timeEnd('[StatusUI] Total stats display');
      return;
    }

    // スケルトン表示の場合
    if (stats?.skeleton) {
      console.debug('[StatusUI] Showing skeleton');
      statsDiv.innerHTML = this.#createSkeletonStats();
      console.timeEnd('[StatusUI] Total stats display');
      return;
    }

    console.time('[StatusUI] HTML generation');
    const isTimeout = !stats || stats.error;
    const html = isTimeout
      ? this.createTimeoutStats()
      : this.createNormalStats(stats);
    console.timeEnd('[StatusUI] HTML generation');

    console.time('[StatusUI] DOM update');
    statsDiv.innerHTML = html;
    console.timeEnd('[StatusUI] DOM update');
    console.timeEnd('[StatusUI] Total stats display');
  }

  showNoZaps() {
    const list = this.root.querySelector(".dialog-zap-list");
    if (list) {
      list.innerHTML = this.#createNoZapsMessage();
    }
  }

  #createSkeletonStats() {
    return `
      <div class="stats-item">Total Count</div>
      <div class="stats-item"><span class="number skeleton">...</span></div>
      <div class="stats-item">times</div>
      <div class="stats-item">Total Amount</div>
      <div class="stats-item"><span class="number skeleton">...</span></div>
      <div class="stats-item">sats</div>
      <div class="stats-item">Max Amount</div>
      <div class="stats-item"><span class="number skeleton">...</span></div>
      <div class="stats-item">sats</div>
    `;
  }

  createTimeoutStats() {
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

  createNormalStats(stats) {
    console.debug('[StatusUI] Creating normal stats:', stats);
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

  #createNoZapsMessage() {
    return `
      <div class="no-zaps-message">
        No Zaps yet!<br>Send the first Zap!
      </div>
    `;
  }
}
