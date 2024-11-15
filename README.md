# nostr-zap-view

<!-- [![NPM](https://img.shields.io/npm/v/nostr-zap-view.svg)](https://www.npmjs.com/package/nostr-zap-view) -->

View any nostr zaps from anywhere. Supports npub, nprofile, note, and nevent identifiers.

## Usage

To configure a button for displaying zap information, use the following attributes:

- `data-title`: (Optional) Custom title for the zap dialog. If left empty, the identifier will be used as the title.
- `data-identifier`: The Nostr identifier (npub, nprofile, note, or nevent) for which zap information will be displayed.
- `data-max-count`: (Optional) Maximum number of zaps to display. Default is 5 if not specified.
- `data-zap-color-mode`: (Optional) Enable or disable color mode for zap amounts. Set to "true" to enable and "false" to disable.
- `data-relay-urls`: Comma-separated list of relay URLs to fetch zap information from.

```html
<button
  data-title=""
  data-identifier="npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"
  data-max-count="6"
  data-zap-color-mode="true"
  data-relay-urls="wss://relay.nostr.band,wss://nos.lol,wss://nostr.wine,wss://nostr.bitcoiner.social,wss://relay.nostr.wirednet.jp,wss://yabu.me">
  Zap View 👀
</button>
```

Add this script tag right before the bottom closing body tag.
```js
<script src="xxx"></script>
```
