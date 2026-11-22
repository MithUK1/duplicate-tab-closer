# Conventions

Short rules this tool follows, so changes stay consistent.

Current version: 1.4.0. Repository: https://github.com/MithUK1/duplicate-tab-closer

## UI look

- Plain HTML and CSS, no frameworks. Each page carries its own small `<style>` block.
- System font (`system-ui`), 15px body on the settings page, 13.5px in the popup.
- Light and dark themes follow the browser (`color-scheme: light dark`, and a `prefers-color-scheme` block that swaps the colour variables).
- One accent colour for the main action (blue, `--accent`), red only for destructive or "closing" cues, green for confirmation such as "Saved".
- Section headings on the settings page are small uppercase labels. Controls sit directly under them, one setting per row.
- Rounded corners (8 to 10px), no drop shadows inside extension pages.
- Settings save the moment a control changes and show a brief "Saved" flash. There is no Save button.

## Help text

- Every setting has a one-line grey `<small>` hint directly under its label.
- Each settings heading has a `?` button that opens a short explanation of that section. All of that wording lives in `extension/src/help.js`, in `HELP`.
- A Help link at the top right of the settings page, and a Help button in the popup, open the README on GitHub (`README_URL` in `help.js`).
- The version shows as `vX.Y.Z`, small, in the bottom left corner of the settings, popup and history pages. It is read from the manifest, so it never needs editing by hand.
- Sentence case, plain words, no jargon. Say what happens, then what the default is ("Off by default.").
- Where a setting has an on and an off effect, state both ("When off, ...").
- No dashes as punctuation in prose. Use commas, full stops or a single hyphen.
- README, hints and store text must match the behaviour. Change them in the same commit as the code.

## Version scheme

- `MAJOR.MINOR.PATCH`. Patch for fixes, minor for new features or settings, major for breaking changes to saved settings.
- The version lives in three places and must match: `extension/manifests/chrome.json`, `extension/manifests/firefox.json` and `package.json`.
- Mozilla rejects a version number it has already seen, in either channel, so every upload gets a new number.
- Update the version in the README header and in this file when it changes.

## Config handling

- Settings live in `storage.local` and sync nowhere. Nothing is sent off the device.
- Defaults are declared once in `DEFAULTS` in `extension/src/background.js`, and mirrored in `extension/src/options.js`. Add a new setting to both.
- Reads always merge over the defaults (`{ ...DEFAULTS, ...stored }`), so a missing key falls back safely and older saved settings keep working.
- Runtime working data (tab cache, closing records, allow list) and the closed tab history live in `storage.session`, which is memory only. The history moves to `storage.local` only when the user opts in.
- Read-modify-write on session data goes through the `locked()` queue so events cannot overwrite each other.
- Clearing the history must leave no copy of closed tab URLs anywhere. A test covers this.

## Code style

- Plain JavaScript (ES2020+), no bundler, no dependencies at runtime. `extension/src/` ships as written.
- Two-space indentation, double quotes, semicolons, `const` by default, `async`/`await` over promise chains.
- Browser API through `const api = globalThis.browser ?? globalThis.chrome;` so one code base serves both browsers.
- Files are grouped with section banners (`/* ---------- name ---------- */`) and small single-purpose functions.
- Comments explain why, not what, and sit above the code they describe.
- No dead code, no commented-out code, no unused CSS.
- Behaviour changes come with a test in `tests/background.test.js`. Run `npm test` and `npm run lint` before every release. Both must be clean.
