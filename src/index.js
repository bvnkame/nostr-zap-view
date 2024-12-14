import { 
  APP_CONFIG, 
  ViewerConfig 
} from "./AppSettings.js";
import {
  createDialog,
  showDialog,
  renderZapListFromCache,
} from "./UIManager.js";
import { subscriptionManager } from "./ZapManager.js";
import { statsManager } from "./StatsManager.js";
import { profilePool } from "./ProfilePool.js";
import { eventPool } from "./EventPool.js";
import { cacheManager } from "./CacheManager.js";


// 初期化関連の処理をまとめる
async function initializeViewer(viewId, config) {
  const cachedEvents = cacheManager.getZapEvents(viewId);
  if (cachedEvents.length > 0) {
    const pubkeys = [...new Set(cachedEvents.map(event => event.pubkey))];
    profilePool.fetchProfiles(pubkeys);
  }

  const { hasEnoughCachedEvents } = await cacheManager.processCachedData(
    viewId,
    config,
    renderZapListFromCache
  );

  if (hasEnoughCachedEvents) {
    subscriptionManager.setupInfiniteScroll(viewId);
  }

  return hasEnoughCachedEvents;
}

async function handleButtonClick(button, viewId) {
  try {
    const config = ViewerConfig.fromButton(button);
    if (!config) {
      throw new Error('Failed to create config from button');
    }

    subscriptionManager.setViewConfig(viewId, config);
    const dialog = await createDialog(viewId, config);
    
    if (!dialog) {
      throw new Error(APP_CONFIG.ZAP_CONFIG.ERRORS.DIALOG_NOT_FOUND);
    }

    await showDialog(viewId);

    // 非同期処理を実行
    setTimeout(async () => {
      await initializeViewer(viewId, config);

      if (!button.hasAttribute("data-initialized")) {
        const identifier = button.getAttribute("data-nzv-id");
        await Promise.all([
          eventPool.connectToRelays(config.relayUrls),
          subscriptionManager.initializeSubscriptions(config, viewId),
          !profilePool.isInitialized ? profilePool.initialize() : Promise.resolve(),
          // 統計情報の初期化を一度だけ行う
          identifier ? statsManager.initializeStats(identifier, viewId, true) : Promise.resolve()
        ]);
        button.setAttribute("data-initialized", "true");
      }
    }, 0);
  } catch (error) {
    console.error(`Failed to handle click for viewId ${viewId}:`, error);
  }
}

function initializeApp() {
  Object.entries(APP_CONFIG.LIBRARIES).forEach(([key, value]) => {
    window[key] = value;
  });

  document.querySelectorAll("button[data-nzv-id]").forEach((button, index) => {
    if (button.hasAttribute("data-zap-view-id")) return;
    
    const viewId = `nostr-zap-view-${index}`;
    button.setAttribute("data-zap-view-id", viewId);

    if (!button.hasAttribute("data-zap-color-mode")) {
      button.setAttribute("data-zap-color-mode", APP_CONFIG.ZAP_CONFIG.DEFAULT_COLOR_MODE.toString());
    }

    button.addEventListener("click", () => handleButtonClick(button, viewId));
  });
}

document.addEventListener("DOMContentLoaded", initializeApp);

export { profilePool, eventPool, APP_CONFIG };
