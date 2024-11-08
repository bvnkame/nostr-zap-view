import { profilePool } from "./ZapPool.js";

// Nostrのプロフィール情報を管理するクラス
export class ProfileManager {
  constructor() {
    // デフォルトのリレーサーバー一覧
    this.profileRelays = ["wss://purplepag.es", "wss://directory.yabu.me", "wss://relay.nostr.band"];
    this.profileCache = new Map();
    this.profileFetchPromises = new Map();
  }

  // プロフィール情報をリレーから取得する
  async fetchProfile(pubkey) {
    if (this.profileCache.has(pubkey)) {
      console.log(`キャッシュからプロフィールを取得: ${pubkey}`);
      return this.profileCache.get(pubkey);
    }

    if (this.profileFetchPromises.has(pubkey)) {
      return this.profileFetchPromises.get(pubkey);
    }

    const fetchPromise = this._fetchProfileFromRelay(pubkey);
    this.profileFetchPromises.set(pubkey, fetchPromise);
    return fetchPromise;
  }

  // リレーサーバーからプロフィール情報を取得する内部メソッド
  async _fetchProfileFromRelay(pubkey) {
    try {
      console.log(`リレーからプロフィールを取得: ${pubkey}`);
      const [profile] = await profilePool.querySync(this.profileRelays, { 
        kinds: [0], 
        authors: [pubkey] 
      });
      
      const parsedProfile = profile ? JSON.parse(profile.content) : null;
      this.profileCache.set(pubkey, parsedProfile);
      console.log(`プロフィールをキャッシュに保存: ${pubkey}`, 
        parsedProfile || "プロフィールが見つかりません");
      
      return parsedProfile;
    } catch (error) {
      console.error("プロフィールの取得に失敗しました:", error);
      return null;
    } finally {
      this.profileFetchPromises.delete(pubkey);
    }
  }

  // キャッシュされたプロフィール情報をクリアする
  clearCache() {
    this.profileCache.clear();
    this.profileFetchPromises.clear();
  }
}

// シングルトンインスタンスをエクスポート
export const profileManager = new ProfileManager();
