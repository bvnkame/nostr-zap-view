import { decode as decodeBolt11 } from "light-bolt11-decoder";
import * as NostrTools from "nostr-tools";

// アプリケーションの設定を集約
export const APP_CONFIG = {
  LIBRARIES: {
    decodeBolt11,
    NostrTools,
  },
  DEFAULT_OPTIONS: {
    theme: "light",
    maxCount: 5,
    colorMode: true,  // 追加: カラーモードのデフォルト値
  },
};

// Zap関連の設定を修正
export const ZAP_CONFIG = {
  SUBSCRIPTION_TIMEOUT: 20000,  // 変更: ネストを解除
  DEFAULT_LIMIT: 1,            // 変更: ネストを解除
  ERRORS: {
    DIALOG_NOT_FOUND: "Zapダイアログが見つかりません",
    BUTTON_NOT_FOUND: "取得ボタンが見つかりません",
    DECODE_FAILED: "識別子のデコードに失敗しました",
  },
};

// プロフィール管理の設定
export const PROFILE_CONFIG = {
  BATCH_SIZE: 20,
  BATCH_DELAY: 100,
  RELAYS: ["wss://purplepag.es", "wss://directory.yabu.me", "wss://relay.nostr.band"],
};

export class ZapConfig {
  constructor(identifier, maxCount, relayUrls) {
    this.identifier = identifier;
    // maxCountが不正な値の場合は初期値を使用
    this.maxCount = this.validateMaxCount(maxCount) ? maxCount : APP_CONFIG.DEFAULT_OPTIONS.maxCount;
    this.relayUrls = relayUrls;
  }

  validateMaxCount(count) {
    return typeof count === 'number' && !isNaN(count) && count > 0;
  }

  static fromButton(button) {
    if (!button) throw new Error(ZAP_CONFIG.ERRORS.BUTTON_NOT_FOUND);
    const maxCount = parseInt(button.getAttribute("data-max-count"), 10);
    return new ZapConfig(
      button.getAttribute("data-identifier"),
      maxCount,  // parseIntの結果がNaNの場合も含めてconstructorで処理
      button.getAttribute("data-relay-urls").split(",")
    );
  }
}