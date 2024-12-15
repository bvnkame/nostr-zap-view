import { profilePool } from "../ProfilePool.js";
import {
  getProfileDisplayName,
  escapeHTML,
  sanitizeImageUrl,
  encodeNprofile, // Add import
} from "../utils.js";
import { cacheManager } from "../CacheManager.js";  // 追加

export class ProfileUI {
  async loadAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const nameElement = element.querySelector(".sender-name");
      const nameContainer = element.querySelector(".zap-placeholder-name");
      const iconContainer = element.querySelector(".sender-icon");
      const skeleton = iconContainer?.querySelector(".zap-placeholder-icon");
      const pubkeyElement = element.querySelector(".sender-pubkey");

      const [profile] = await profilePool.fetchProfiles([pubkey]);

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
    return Object.assign(document.createElement("img"), {
      src: robohashUrl,
      alt: altText,
      loading: "lazy",
      className: "profile-icon",
    });
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
        img.src = profile.picture;
        img.alt = profile.name || 'Profile Picture';
        img.width = 40;
        img.height = 40;
        if (iconElement.parentElement) {
          iconElement.parentElement.replaceChild(img, iconElement);
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
