# Duplicate Tab Closer

Closes duplicate browser tabs, either automatically as they open or on demand with one click. Works in Chrome, Edge, Brave and Firefox.

| | |
| --- | --- |
| Version | 1.3.2 |
| Repository | https://github.com/MithUK1/duplicate-tab-closer |
| Licence | MIT |

## Features

- **One-click cleanup.** Click the toolbar icon to close every duplicate tab. The icon shows a live count of how many tabs a click would close.
- **Auto-close.** Optionally closes the tab you are looking at the moment it loads a page you already have open, and takes you to the existing one.
- **Background tabs are left alone.** A link opened in the background (middle click) is never closed or switched to. It stays open and is counted on the icon, so you choose when to close it.
- **Your own duplicates are kept.** A tab made with right-click > Duplicate stays open, unless you switch that option on.
- **Right-click menu on the icon.** Close all duplicates, close duplicates of the current tab, reopen the last closed duplicate, browse recently closed tabs, open the full history.
- **Undo, one tab at a time.** Reopen steps back through closed duplicates, newest first. Reopened tabs return to the position they were closed from.
- **Closed tab history** with search, filters and reopen. Entries are forgotten after a set number of minutes (5 by default) and the whole history is wiped when the browser closes, unless you choose otherwise.
- **Configurable.** Which duplicate to close, what counts as a duplicate, sites to never touch, confirmation prompts and more.

## Install

Build the unpacked extensions first (needs Node 18 or newer, no dependencies):

```
npm run build
```

This creates `dist/chrome` and `dist/firefox`.

### Chrome, Edge, Brave

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. Click **Load unpacked** and choose `dist/chrome`.

### Firefox

Firefox release builds only install extensions that Mozilla has signed.

- **Quick test:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and choose `dist/firefox/manifest.json`. It is removed when Firefox restarts.
- **Permanent install:** sign it for your own use. Run `npm install` then `npm run pack:firefox`, upload the zip from `dist/packages` to the [Add-on Developer Hub](https://addons.mozilla.org/developers/) as an unlisted add-on ("On your own"), then install the signed `.xpi` from `about:addons`. Each upload needs a new `version` in `manifests/firefox.json`.
- Firefox Developer Edition, Nightly and ESR can run it unsigned by setting `xpinstall.signatures.required` to `false` in `about:config`.

## Using it

**Toolbar click** does what you choose in Settings: close all duplicates (default), close duplicates of the current tab, or show a menu. It can ask for confirmation first.

**Right-click the icon** for the quick menu. Chrome adds an **Options** entry there for the settings page.

### Settings

| Setting | What it does |
| --- | --- |
| Toolbar click | Close all, close this tab's duplicates, or show the menu |
| Ask before closing | Shows how many tabs will close, with a cancel option |
| Duplicate count on icon | Live badge, hidden when there are none |
| Auto-close duplicates as they open | On by default. Only applies to the tab you are looking at |
| Check all windows | Or only the window the tab is in |
| Also auto-close tabs I duplicate on purpose | Off by default |
| When a duplicate opens, keep | The existing tab or the new one |
| When closing in bulk, close | The one furthest right (default), the most recently opened, or keep the active tab |
| Ignore #fragment / ?query | What counts as the same page |
| Never touch these sites | One domain per line, subdomains included |
| Record tabs I close myself | Duplicates closed by the extension are always recorded |
| Keep the history after the browser closes | Off by default |
| Maximum history entries | 500 by default |
| Forget closed tabs after | Minutes before an entry is removed for good. 5 by default, 0 keeps them until cleared |

Pinned tabs are always kept in preference to unpinned ones.

## How duplicates are detected

Two tabs are duplicates when their URLs match after the options above are applied. Only `http`, `https`, `file` and `ftp` pages are compared. Normal and private tabs are never matched with each other.

Browsers do not say when a tab was made with **Duplicate**. The extension treats a new tab as a deliberate duplicate when it opens directly beside a tab with the same URL, or its opener has the same URL. Those tabs, and the tab they came from, are exempt from auto-close. As a result, a tab opened right next to a tab with the same URL is also left open.

Auto-close only acts on the tab in front of you. A duplicate that opens in the background is left open and counted on the toolbar icon until you close it.

## Privacy

Nothing leaves your browser and nothing is collected. The `tabs` permission is used to read tab URLs and titles for comparison and for the closed tab history. The `contextMenus` permission adds the right-click menu on the icon, `alarms` runs the once-a-minute clean-up of expired history, and `storage` holds settings.

The closed tab history is kept in memory only. Each entry is removed after the retention time (5 minutes by default), and everything is wiped when the browser closes or the extension is reloaded. If you turn on **Keep the history after the browser closes**, URLs and titles of closed tabs are saved in the browser profile until they expire or you clear them. Clearing the history also removes the extension's internal working copies of closed tab URLs.

## Development

```
npm test             # run the logic tests against a mocked browser API
npm run lint         # build and lint the Firefox extension with web-ext
npm run pack:firefox # build a zip for submission to Mozilla
```

The code is plain JavaScript with no bundler or build tooling, so what is in `src/` is exactly what ships. The only build step copies `src/` and the right manifest into `dist/`. See [CONVENTIONS.md](CONVENTIONS.md) for the UI, help text, versioning, config and code style rules.

| Path | Contents |
| --- | --- |
| `src/background.js` | All logic: duplicate detection, history, menus, badge |
| `src/popup.*` | Toolbar menu, used when the click action is set to menu |
| `src/confirm.*` | Confirmation popup |
| `src/options.*` | Settings page |
| `src/history.*` | Closed tab history page |
| `manifests/` | One manifest per browser. Chrome needs `background.service_worker`, Firefox needs `background.scripts` |
| `store/` | Store listing text, icon and promo images, screenshots |
| `test/` | Tests |

## Licence

MIT. See [LICENSE](LICENSE).
