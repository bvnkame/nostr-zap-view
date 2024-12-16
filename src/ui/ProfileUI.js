import { profilePool } from "../ProfilePool.js";
import {
  getProfileDisplayName,
  escapeHTML,
  sanitizeImageUrl,
  encodeNprofile,
} from "../utils.js";
import { cacheManager } from "../CacheManager.js";
import defaultIcon from "../assets/nostr-icon.svg";

export class ProfileUI {
  async loadAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const nameElement = element.querySelector(".sender-name");
      const nameContainer = element.querySelector(".zap-placeholder-name");
      const iconContainer = element.querySelector(".sender-icon");
      const skeleton = iconContainer?.querySelector(".zap-placeholder-icon");
      const pubkeyElement = element.querySelector(".sender-pubkey");

      let profile = cacheManager.getProfile(pubkey);

      const senderName = profile
        ? getProfileDisplayName(profile) || "nameless"
        : "anonymous";
      const senderIcon = profile?.picture
        ? sanitizeImageUrl(profile.picture)
        : null;

      this.#updateName(nameContainer, nameElement, senderName);
      this.#updateIcon(skeleton, iconContainer, senderIcon, senderName);
      this.#updateNip05(pubkeyElement, pubkey);
    } catch (error) {
      console.debug("Failed to load profile:", error);
      this.#setDefaultIcon(element);
    }
  }

  #updateName(nameContainer, nameElement, senderName) {
    if (nameContainer) {
      nameContainer.replaceWith(
        Object.assign(document.createElement("span"), {
          className: "sender-name",
          textContent: senderName,
        })
      );
    } else if (nameElement) {
      nameElement.textContent = senderName;
    }
  }

  #createDefaultIcon(pubkey, altText = "anonymous user's icon") {
    const robohashUrl = `https://robohash.org/${pubkey}.png?set=set5&bgset=bg2&size=128x128`;
    const cachedImage = cacheManager.getImageCache(robohashUrl);
    
    const img = Object.assign(document.createElement("img"), {
      alt: altText,
      loading: "lazy",
      className: "profile-icon",
    });

    if (cachedImage) {
      img.src = robohashUrl;
      return img;
    }

    // Load and cache the robohash image with fallback
    const tempImg = new Image();
    tempImg.onerror = () => {
      img.src = defaultIcon;
      cacheManager.setImageCache(robohashUrl, defaultIcon);
    };
    tempImg.onload = () => {
      cacheManager.setImageCache(robohashUrl, tempImg);
    };
    tempImg.src = robohashUrl;
    img.src = robohashUrl;

    return img;
  }

  #updateIcon(skeleton, iconContainer, senderIcon, senderName) {
    if (skeleton && iconContainer) {
      const updateIcon = (src) => {
        skeleton.remove();
        const existingImage = iconContainer.querySelector('img');
        const existingLink = iconContainer.querySelector('a');
        if (existingImage) existingImage.remove();
        if (existingLink) existingLink.remove();

        const img = src === 'robohash' 
          ? this.#createDefaultIcon(iconContainer.closest("[data-pubkey]")?.dataset.pubkey, `${escapeHTML(senderName)}'s icon`)
          : Object.assign(document.createElement("img"), {
              src,
              alt: `${escapeHTML(senderName)}'s icon`,
              loading: "lazy",
              className: "profile-icon",
            });

        const pubkey = iconContainer.closest("[data-pubkey]")?.dataset.pubkey;
        if (pubkey) {
          const nprofile = encodeNprofile(pubkey);
          const link = Object.assign(document.createElement("a"), {
            href: `https://njump.me/${nprofile}`,
            target: "_blank",
            rel: "noopener noreferrer",
          });
          link.appendChild(img);
          iconContainer.appendChild(link);
        } else {
          iconContainer.appendChild(img);
        }
      };

      if (senderIcon) {
        const img = new Image();
        img.onload = () => {
          cacheManager.setImageCache(senderIcon, img);
          updateIcon(senderIcon);
        };
        img.onerror = () => {
          updateIcon('robohash');
        };
        img.src = senderIcon;
      } else {
        updateIcon('robohash');
      }
    }
  }

  #updateNip05(pubkeyElement, pubkey) {
    if (pubkeyElement && !pubkeyElement.getAttribute("data-nip05-updated")) {
      const cachedNip05 = profilePool.getNip05(pubkey);
      if (cachedNip05) {
        pubkeyElement.textContent = cachedNip05;
        pubkeyElement.setAttribute("data-nip05-updated", "true");
      } else {
        profilePool.verifyNip05Async(pubkey).then((nip05) => {
          if (nip05) {
            pubkeyElement.textContent = nip05;
            pubkeyElement.setAttribute("data-nip05-updated", "true");
          }
        });
      }
    }
  }

  #setDefaultIcon(element) {
    const skeleton = element.querySelector(".zap-placeholder-icon");
    if (skeleton) {
      const iconContainer = skeleton.parentElement;
      const pubkey = element.closest("[data-pubkey]")?.dataset.pubkey;
      skeleton.remove();
      iconContainer.appendChild(this.#createDefaultIcon(pubkey));
    }
  }

  /**
   * プロフィール要素を更新
   * @param {HTMLElement} element 更新対象の要素
   * @param {Object} profile プロフィール情報
   */
  async updateProfileElement(element, profile) {
    if (!element || !profile) return;

    // アイコン要素の更新
    const iconElement = element.querySelector('.sender-icon img, .zap-placeholder-icon');
    if (iconElement) {
      if (profile.picture) {
        const img = document.createElement('img');
        img.alt = profile.name || 'Profile Picture';
        img.width = 32;
        img.height = 32;
        img.className = 'profile-icon';

        // 画像読み込みエラー時の処理を追加
        img.onerror = () => {
          const pubkey = element.getAttribute('data-pubkey');
          if (pubkey) {
            const robohashImg = this.#createDefaultIcon(pubkey, profile.name || 'anonymous user');
            if (img.parentElement) {
              img.parentElement.replaceChild(robohashImg, img);
            }
          }
        };

        img.src = profile.picture;
        if (iconElement.parentElement) {
          iconElement.parentElement.replaceChild(img, iconElement);
        }
      } else {
        // プロフィール画像が存在しない場合は直接robohashを使用
        const pubkey = element.getAttribute('data-pubkey');
        if (pubkey) {
          const robohashImg = this.#createDefaultIcon(pubkey, profile.name || 'anonymous user');
          if (iconElement.parentElement) {
            iconElement.parentElement.replaceChild(robohashImg, iconElement);
          }
        }
      }
    }

    // 名前要素の更新
    const nameElement = element.querySelector('.sender-name, .zap-placeholder-name');
    if (nameElement) {
      nameElement.textContent = profile.display_name || profile.name || 'anonymous';
      nameElement.className = 'sender-name';
    }

    // NIP-05の更新
    if (profile.nip05) {
      const pubkey = element.getAttribute('data-pubkey');
      if (pubkey) {
        const nip05Element = element.querySelector('[data-nip05-target="true"]');
        if (nip05Element) {
          await this.updateNip05Display(pubkey, nip05Element);
        }
      }
    }
  }
}
