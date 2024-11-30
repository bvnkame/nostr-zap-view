import { profileManager } from "./ProfileManager.js";
import defaultIcon from "./assets/nostr-icon.svg";
import { nip19 } from "nostr-tools";
import {
  getProfileDisplayName,
  escapeHTML,
  sanitizeImageUrl,
} from "./utils.js";

export class ProfileUI {
  async loadAndUpdate(pubkey, element) {
    if (!pubkey) return;

    try {
      const nameElement = element.querySelector(".sender-name");
      const nameContainer = element.querySelector(".zap-placeholder-name");
      const iconContainer = element.querySelector(".sender-icon");
      const skeleton = iconContainer?.querySelector(".zap-placeholder-icon");
      const pubkeyElement = element.querySelector(".sender-pubkey");

      const [profile] = await profileManager.fetchProfiles([pubkey]);

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

  #updateIcon(skeleton, iconContainer, senderIcon, senderName) {
    if (skeleton && iconContainer) {
      const updateIcon = (src) => {
        skeleton.remove();
        const img = Object.assign(document.createElement("img"), {
          src,
          alt: `${escapeHTML(senderName)}'s icon`,
          loading: "lazy",
          className: "profile-icon",
        });

        // Create link wrapper
        const pubkey = iconContainer.closest("[data-pubkey]")?.dataset.pubkey;
        if (pubkey) {
          const nprofile = nip19.nprofileEncode({
            pubkey: pubkey,
            relays: []
          });
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
        img.onload = () => updateIcon(senderIcon);
        img.onerror = () => updateIcon(defaultIcon);
        img.src = senderIcon;
      } else {
        updateIcon(defaultIcon);
      }
    }
  }

  #updateNip05(pubkeyElement, pubkey) {
    if (pubkeyElement && !pubkeyElement.getAttribute("data-nip05-updated")) {
      const cachedNip05 = profileManager.getNip05(pubkey);
      if (cachedNip05) {
        pubkeyElement.textContent = cachedNip05;
        pubkeyElement.setAttribute("data-nip05-updated", "true");
      } else {
        profileManager.verifyNip05Async(pubkey).then((nip05) => {
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
      skeleton.remove();
      const defaultImg = Object.assign(document.createElement("img"), {
        src: defaultIcon,
        alt: "anonymous user's icon",
        loading: "lazy",
        className: "profile-icon",
      });
      iconContainer.appendChild(defaultImg);
    }
  }
}
