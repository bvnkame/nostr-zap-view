// メインのエントリーポイント
import { decode as decodeBolt11 } from "light-bolt11-decoder";
import * as NostrTools from "nostr-tools";
import { fetchLatestZaps } from "./ZapManager.js";
import { createDialog } from "./UIManager.js";

// 必要に応じてライブラリをグローバルにアクセス可能にする
window.decodeBolt11 = decodeBolt11;
window.NostrTools = NostrTools;

// ダイアログを動的に作成
createDialog();

const fetchButton = document.querySelector('button[data-identifier]');
if (fetchButton) {
    fetchButton.addEventListener("click", fetchLatestZaps);
}
