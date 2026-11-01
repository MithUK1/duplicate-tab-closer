# Store listing text

## Name
Duplicate Tab Closer

## Summary (max 132 characters)
Close duplicate tabs automatically or with one click. Live count, undo history and full control over what counts.

## Description
Duplicate Tab Closer keeps your tab bar tidy. It spots tabs that show the same page and closes the extras, either as they open or when you click the toolbar icon.

- One click closes every duplicate. The toolbar icon shows a live count, so you know how many will go before you click.
- Auto-close a duplicate you open in front of you, and jump to the tab you already had. Links opened in the background (middle click) are left alone and counted on the toolbar icon, so you decide when to close them.
- Tabs you duplicate on purpose with right-click > Duplicate are left alone, unless you switch that option on.
- Reopen closed duplicates one at a time, newest first. Each tab returns to the position it was closed from.
- Search, filter and reopen anything from the closed tab history. The history forgets entries after 5 minutes by default (you choose the time) and is wiped when the browser closes.
- Choose what counts as a duplicate: ignore the #fragment or ?query, check all windows or one, and list sites that must never be touched.
- Choose which duplicate is closed: the one furthest right, the most recently opened, or keep the active tab. Pinned tabs are always kept.

Private by design: nothing leaves your browser and nothing is collected.

## Category
Productivity (Chrome) / Tabs (Firefox)

## Chrome Web Store: privacy tab
Single purpose: Close duplicate browser tabs.

Permission justifications:
- tabs: Reads the URL and title of open tabs to find duplicates, close them and build the closed tab history.
- storage: Saves the user's settings, and keeps the closed tab history in memory (session storage) or, if the user opts in, in the browser profile.
- contextMenus: Adds the right-click menu on the toolbar icon (close duplicates, reopen, history, settings).
- alarms: Runs a once-a-minute clean-up that removes closed tab history entries older than the retention time.

Data usage: no user data is collected, transmitted or sold. Remote code: none.
Privacy policy URL: https://github.com/MithUK1/duplicate-tab-closer#privacy

## Firefox (AMO)
Data collection: none required (declared in the manifest).
Source code: https://github.com/MithUK1/duplicate-tab-closer (build with `npm run build`, output in dist/firefox)
