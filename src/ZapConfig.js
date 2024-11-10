
import { APP_CONFIG } from "./index.js";

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
    if (!button) throw new Error(CONFIG.ERRORS.BUTTON_NOT_FOUND);
    const maxCount = parseInt(button.getAttribute("data-max-count"), 10);
    return new ZapConfig(
      button.getAttribute("data-identifier"),
      maxCount,  // parseIntの結果がNaNの場合も含めてconstructorで処理
      button.getAttribute("data-relay-urls").split(",")
    );
  }
}