import { profilePool } from "./ZapPool.js";

// Nostrのプロフィール情報を管理するクラス
export class ProfileManager {
  constructor() {
    // デフォルトのリレーサーバー一覧
    this.profileRelays = ["wss://purplepag.es", "wss://directory.yabu.me", "wss://relay.nostr.band"];
    this.profileCache = new Map();
    this.profileFetchPromises = new Map();
    this.batchQueue = new Set(); // バッチ処理用のキュー
    this.BATCH_SIZE = 20; // 一度に取得するプロフィールの最大数
    this.batchTimer = null;
    this.BATCH_DELAY = 100; // バッチ処理の待機時間（ミリ秒）
    this.resolvers = new Map(); // resolve関数を保存するMapを追加
  }

  // 単一プロフィール取得（リアルタイム用）
  async fetchProfile(pubkey) {
    if (this.profileCache.has(pubkey)) {
      return this.profileCache.get(pubkey);
    }

    if (this.profileFetchPromises.has(pubkey)) {
      return this.profileFetchPromises.get(pubkey);
    }

    const promise = new Promise((resolve) => {
      this.resolvers.set(pubkey, resolve);
    });

    this.profileFetchPromises.set(pubkey, promise);
    this.batchQueue.add(pubkey);

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => this._processBatchQueue(), this.BATCH_DELAY);

    return promise;
  }

  // バッチ処理用のプロフィール取得
  async fetchProfiles(pubkeys) {
    const uncachedPubkeys = pubkeys.filter((key) => !this.profileCache.has(key));
    if (uncachedPubkeys.length === 0) {
      return pubkeys.map((key) => this.profileCache.get(key));
    }

    uncachedPubkeys.forEach((key) => this.batchQueue.add(key));

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    await new Promise((resolve) => {
      this.batchTimer = setTimeout(async () => {
        await this._processBatchQueue();
        resolve();
      }, this.BATCH_DELAY);
    });

    return pubkeys.map((key) => this.profileCache.get(key));
  }

  // バッチキューの処理を再帰的に行うように修正
  async _processBatchQueue() {
    if (this.batchQueue.size === 0) return;

    const batchPubkeys = Array.from(this.batchQueue).slice(0, this.BATCH_SIZE);
    this.batchQueue = new Set(Array.from(this.batchQueue).slice(this.BATCH_SIZE));

    console.log(`バッチ処理でプロフィールを取得: ${batchPubkeys.length}件`);
    await this._fetchProfileFromRelay(batchPubkeys);

    // 取得できなかったpubkeyに対してデフォルト値を設定
    batchPubkeys.forEach((pubkey) => {
      if (!this.profileCache.has(pubkey)) {
        this.profileCache.set(pubkey, {
          name: "Unknown",
          display_name: "Unknown",
        });
      }
    });

    // キューにまだデータが残っている場合は再帰的に処理
    if (this.batchQueue.size > 0) {
      // 次のバッチ処理を少し遅延させて実行
      await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
      await this._processBatchQueue();
    }
  }

  // リレーサーバーからプロフィール情報を取得する内部メソッド
  async _fetchProfileFromRelay(pubkeys) {
    try {
      console.log(`リレーからプロフィールを取得`);
      const req = {
        kinds: [0],
        authors: pubkeys,
      };

      console.log("Sending REQ to relays:", this.profileRelays, req);

      const profiles = await profilePool.querySync(this.profileRelays, req);
      const profileMap = new Map();

      // 受信した全てのプロフィールを確実にキャッシュに保存
      profiles.forEach((profile) => {
        try {
          const parsedProfile = JSON.parse(profile.content);
          const pubkey = profile.pubkey;
          this.profileCache.set(pubkey, parsedProfile);
          profileMap.set(pubkey, parsedProfile);

          // resolve関数を呼び出してプロミスを解決
          const resolver = this.resolvers.get(pubkey);
          if (resolver) {
            resolver(parsedProfile);
            this.resolvers.delete(pubkey);
          }
          console.log(`プロフィールをキャッシュに保存: ${pubkey}`);
        } catch (error) {
          console.error(`プロフィールのパースに失敗: ${profile.pubkey}`, error);
        }
      });

      // 取得できなかったpubkeyのプロミスをnullで解決
      pubkeys.forEach((pubkey) => {
        if (!this.profileCache.has(pubkey)) {
          const resolver = this.resolvers.get(pubkey);
          if (resolver) {
            resolver(null);
            this.resolvers.delete(pubkey);
          }
        }
      });

      return profileMap;
    } catch (error) {
      console.error("プロフィールの取得に失敗しました:", error);
      // エラー時は全てのプロミスをnullで解決
      pubkeys.forEach((pubkey) => {
        const resolver = this.resolvers.get(pubkey);
        if (resolver) {
          resolver(null);
          this.resolvers.delete(pubkey);
        }
      });
      return new Map();
    } finally {
      pubkeys.forEach((key) => this.profileFetchPromises.delete(key));
    }
  }

  // キャッシュされたプロフィール情報をクリアする
  clearCache() {
    this.profileCache.clear();
    this.profileFetchPromises.clear();
    this.resolvers.clear(); // resolversもクリア
  }
}

// シングルトンインスタンスをエクスポート
export const profileManager = new ProfileManager();
