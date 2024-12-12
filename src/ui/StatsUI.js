import { formatNumber } from "../utils.js";

export class statsUI {
  constructor(rootElement) {
    this.root = rootElement;
  }

  displayStats(stats) {
    requestAnimationFrame(() => {
      const statsDiv = this.root?.querySelector(".zap-stats");
      if (!statsDiv) {
        console.warn('[statsUI] Stats container not found');
        return;
      }

      try {
        let html;
        if (!stats) {
          html = this.createTimeoutStats();
        } else if (stats.skeleton) {
          html = this.#createSkeletonStats();
        } else if (stats.error) {
          html = this.createTimeoutStats();
        } else {
          html = this.createNormalStats(stats);
        }

        statsDiv.innerHTML = html;
      } catch (error) {
        console.error('[statsUI] Error displaying stats:', error);
        statsDiv.innerHTML = this.createTimeoutStats();
      }
    });
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
}
