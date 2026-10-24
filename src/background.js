const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  autoClose: true,
  ignoreHash: true,
  ignoreQuery: false,
  allWindows: true,
  keep: "existing", // "existing" = keep the older tab, "new" = keep the one just opened
  whitelist: "",
  totalClosed: 0,
  iconAction: "all", // "all" | "current" | "menu" (left-click on the toolbar icon)
  showBadge: true, // live duplicate count on the toolbar icon
  iconConfirm: false, // ask before closing when iconAction is not "menu"
  trackHistory: true, // record non-duplicate closes too (duplicates are always recorded)
  historyLimit: 500,
  closeManualDuplicates: false, // auto-close tabs the user duplicated on purpose (right-click > Duplicate)
  persistHistory: false, // keep closed-tab history after the browser closes (off = session only)
  closeWhich: "right", // bulk close keeps: "right" (closes the furthest right) | "newest" | "active"
};

/* ---------- helpers ---------- */

async function getSettings() {
  const s = await api.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function isCheckable(url) {
  return /^(https?|file|ftp):/i.test(url || "");
}

function parseWhitelist(text) {
  return (text || "")
    .split(/[\n,]+/)
    .map((l) => l.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

function isWhitelisted(url, list) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return list.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function normalise(url, opts) {
  try {
    const u = new URL(url);
    if (opts.ignoreHash) u.hash = "";
    if (opts.ignoreQuery) u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

// Normal and private tabs are never treated as duplicates of each other.
const groupKey = (t, s) => (t.incognito ? "i|" : "n|") + normalise(t.url, s);

const tabInfo = (t) => ({
  url: t.url || t.pendingUrl || "",
  title: t.title || "",
  favIconUrl: t.favIconUrl || "",
  pinned: !!t.pinned,
  windowId: t.windowId,
  index: t.index,
  incognito: !!t.incognito,
});

async function addToTotal(n) {
  if (!n) return;
  const { totalClosed } = await api.storage.local.get({ totalClosed: 0 });
  await api.storage.local.set({ totalClosed: totalClosed + n });
}

function listTabs(allWindows, windowId) {
  return api.tabs.query(allWindows ? {} : { windowId });
}

/* ---------- session-only state (cleared when the browser closes) ---------- */

const sess = api.storage.session;
async function sget(key, def) {
  const r = await sess.get({ [key]: def });
  return r[key];
}
const sset = (key, val) => sess.set({ [key]: val });

// All read-modify-write on session state goes through one queue.
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

// Closed-tab history lives in session storage (wiped when the browser closes) unless the
// user opts in to keeping it, in which case it lives in local storage under the same key.
async function histArea() {
  const { persistHistory } = await api.storage.local.get({ persistHistory: false });
  return persistHistory ? api.storage.local : api.storage.session;
}
async function hget() {
  const area = await histArea();
  return (await area.get({ history: [] })).history;
}
async function hset(value) {
  const area = await histArea();
  return area.set({ history: value });
}

// Called when the "keep history" setting is switched: move the list to the new home.
function migrateHistory(toLocal) {
  return locked(async () => {
    const from = toLocal ? api.storage.session : api.storage.local;
    const to = toLocal ? api.storage.local : api.storage.session;
    const [old, cur, s] = await Promise.all([
      from.get({ history: [] }),
      to.get({ history: [] }),
      getSettings(),
    ]);
    const merged = [...cur.history, ...old.history]
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, Math.max(20, s.historyLimit));
    await to.set({ history: merged });
    await from.remove("history");
  });
}

const EMPTY_ALLOW = () => ({ tabs: {}, urls: {} });

/* ---------- tab cache (so we know what a tab was when it closes) ---------- */

function cacheTab(tab) {
  return locked(async () => {
    const cache = await sget("cache", {});
    cache[tab.id] = tabInfo(tab);
    await sset("cache", cache);
  });
}

async function rebuildCache() {
  const tabs = await api.tabs.query({});
  return locked(async () => {
    const [cache, closing] = await Promise.all([sget("cache", {}), sget("closing", {})]);
    const live = new Set(tabs.map((t) => t.id));
    for (const t of tabs) cache[t.id] = tabInfo(t);

    // A tab missing from two rebuilds in a row has gone, so forget what we knew about it.
    // One miss is tolerated so a tab that is closing right now can still be recorded.
    for (const [id, info] of Object.entries(cache)) {
      if (live.has(Number(id))) continue;
      if (info.gone) delete cache[id];
      else info.gone = true;
    }

    // Close records only matter for a moment; drop any that never completed.
    const now = Date.now();
    for (const [id, c] of Object.entries(closing)) if (now - c.t > 10000) delete closing[id];

    await Promise.all([sset("cache", cache), sset("closing", closing)]);
  });
}

function markClosing(tabs, reason, batch) {
  return locked(async () => {
    const closing = await sget("closing", {});
    for (const t of tabs) closing[t.id] = { reason, batch, info: tabInfo(t), t: Date.now() };
    await sset("closing", closing);
  });
}

api.tabs.onRemoved.addListener((tabId) => {
  locked(async () => {
    const [cache, closing, allow, created] = await Promise.all([
      sget("cache", {}),
      sget("closing", {}),
      sget("allow", EMPTY_ALLOW()),
      sget("created", {}),
    ]);
    const c = closing[tabId];
    const info = c?.info ?? cache[tabId];
    const gone = cache[tabId];
    if (gone && gone.index !== undefined) {
      for (const o of Object.values(cache)) {
        if (o !== gone && o.windowId === gone.windowId && o.index > gone.index) o.index--;
      }
    }
    delete cache[tabId];
    delete closing[tabId];
    delete allow.tabs[tabId];
    delete created[tabId];
    await Promise.all([
      sset("cache", cache),
      sset("closing", closing),
      sset("allow", allow),
      sset("created", created),
    ]);

    if (!info || !isCheckable(info.url) || info.incognito) return;
    const reason = c?.reason ?? "closed";
    const s = await getSettings();
    if (reason !== "duplicate" && !s.trackHistory) return;

    const history = await hget();
    history.unshift({
      id: uid(),
      url: info.url,
      title: info.title,
      favIconUrl: info.favIconUrl,
      pinned: info.pinned,
      windowId: info.windowId,
      index: info.index,
      closedAt: Date.now(),
      reason,
      batch: c?.batch ?? null,
    });
    await hset(history.slice(0, Math.max(20, s.historyLimit)));
  });
});

/* ---------- closing duplicates ---------- */

// Which duplicate survives a bulk close (sorts the one to keep first).
const ORDERS = {
  // keep the leftmost, so the one furthest right is closed (windows ordered by creation)
  right: (a, b) => a.windowId - b.windowId || a.index - b.index,
  // keep the oldest, so the most recently opened is closed
  newest: (a, b) => a.id - b.id,
  // keep the tab you are on, then the oldest
  active: (a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : a.id - b.id),
};

// Returns the tab objects that would be closed.
async function planClose(mode, tabArg) {
  const s = await getSettings();
  const wl = parseWhitelist(s.whitelist);

  if (mode === "current") {
    let cur = tabArg;
    if (!cur) [cur] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (!cur || !isCheckable(cur.url) || isWhitelisted(cur.url, wl)) return [];
    const key = groupKey(cur, s);
    const tabs = await listTabs(s.allWindows, cur.windowId);
    return tabs.filter(
      (t) => t.id !== cur.id && !t.pinned && isCheckable(t.url) && groupKey(t, s) === key
    );
  }

  let windowId = tabArg?.windowId;
  if (!s.allWindows && windowId === undefined) windowId = (await api.windows.getLastFocused()).id;
  const tabs = await listTabs(s.allWindows, windowId);
  const groups = new Map();
  for (const tab of tabs) {
    if (!isCheckable(tab.url) || isWhitelisted(tab.url, wl)) continue;
    const key = groupKey(tab, s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }

  const toClose = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // The first tab after sorting is the one kept. Pinned tabs always win.
    const order = ORDERS[s.closeWhich] ?? ORDERS.right;
    group.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : order(a, b)));
    toClose.push(...group.slice(1));
  }
  return toClose;
}

async function execute(mode, tabArg) {
  const tabs = await planClose(mode, tabArg);
  if (!tabs.length) return 0;
  await markClosing(tabs, "duplicate", uid());
  try {
    await api.tabs.remove(tabs.map((t) => t.id));
  } catch {}
  await addToTotal(tabs.length);
  return tabs.length;
}

// Auto mode: runs when a tab finishes loading or changes URL.
async function checkTab(tab) {
  const s = await getSettings();
  if (!s.autoClose || !isCheckable(tab.url)) return;
  if (isWhitelisted(tab.url, parseWhitelist(s.whitelist))) return;

  const key = groupKey(tab, s);

  // Wait for any pending bookkeeping (e.g. a just-created tab being flagged as a
  // deliberate duplicate) before deciding anything.
  await locked(() => {});

  // Restored tabs and deliberate duplicates are allowed to stay.
  let allow = await sget("allow", EMPTY_ALLOW());
  if (allow.tabs[tab.id] === key) return;
  const exp = allow.urls[normalise(tab.url, s)];
  if (exp && exp > Date.now()) return;

  // The URL wasn't known when the tab was created, so check now whether it is a copy of
  // the tab beside it (or its opener). Only shortly after creation.
  if (!s.closeManualDuplicates) {
    const c = (await sget("created", {}))[tab.id];
    if (c && Date.now() - c.t < DUP_WINDOW_MS) {
      const flagged = await locked(() => flagIfDeliberate(tab.id, key, [c.left, c.opener]));
      if (flagged) return;
    }
  }
  allow = await sget("allow", EMPTY_ALLOW());

  // ...and they are not treated as the "existing" tab either, so reloading the
  // original never gets it closed in favour of its copy.
  const all = await listTabs(s.allWindows, tab.windowId);
  const others = all.filter(
    (t) =>
      t.id !== tab.id &&
      isCheckable(t.url) &&
      groupKey(t, s) === key &&
      allow.tabs[t.id] !== key
  );
  if (!others.length) return;

  try {
    const pinned = others.find((t) => t.pinned);
    const batch = uid();
    if (s.keep === "new" && !pinned) {
      await markClosing(others, "duplicate", batch);
      await api.tabs.remove(others.map((t) => t.id));
      await addToTotal(others.length);
    } else {
      const keep = pinned ?? others[0];
      await markClosing([tab], "duplicate", batch);
      await api.tabs.update(keep.id, { active: true });
      await api.windows.update(keep.windowId, { focused: true });
      await api.tabs.remove(tab.id);
      await addToTotal(1);
    }
  } catch {
    // tab already gone
  }
}

/* ---------- history and restore ---------- */

// Empties the history and purges the working data that could still mention a closed tab.
function clearHistory() {
  return locked(async () => {
    const live = new Set((await api.tabs.query({})).map((t) => t.id));
    const [cache, allow, created] = await Promise.all([
      sget("cache", {}),
      sget("allow", EMPTY_ALLOW()),
      sget("created", {}),
    ]);
    for (const id of Object.keys(cache)) if (!live.has(Number(id))) delete cache[id];
    for (const id of Object.keys(allow.tabs)) if (!live.has(Number(id))) delete allow.tabs[id];
    for (const id of Object.keys(created)) if (!live.has(Number(id))) delete created[id];
    allow.urls = {};
    await Promise.all([
      hset([]),
      sset("cache", cache),
      sset("closing", {}),
      sset("allow", allow),
      sset("created", created),
    ]);
  });
}

async function restoreEntries(entries, activate) {
  if (!entries.length) return 0;
  const s = await getSettings();

  // Tell the auto-closer to leave these alone.
  const until = Date.now() + 60000;
  await locked(async () => {
    const allow = await sget("allow", EMPTY_ALLOW());
    for (const e of entries) allow.urls[normalise(e.url, s)] = until;
    await sset("allow", allow);
  });

  const restored = [];
  // Lowest positions first, so tabs that were closed together land back where they were.
  const ordered = [...entries].sort(
    (a, b) => a.windowId - b.windowId || (a.index ?? 0) - (b.index ?? 0)
  );
  for (const [i, e] of ordered.entries()) {
    try {
      const props = { url: e.url, active: activate && i === 0, pinned: e.pinned };
      // Original window and position first, then just the window, then wherever.
      const attempts = [
        e.index === undefined ? { windowId: e.windowId } : { windowId: e.windowId, index: e.index },
        { windowId: e.windowId },
        {},
      ];
      let tab;
      for (const extra of attempts) {
        try {
          tab = await api.tabs.create({ ...props, ...extra });
          break;
        } catch {
          // window gone or position refused, try the next fallback
        }
      }
      if (!tab) continue;
      restored.push({
        entry: e,
        tabId: tab.id,
        key: groupKey({ url: e.url, incognito: tab.incognito }, s),
      });
    } catch {
      // skip URLs the browser refuses to open
    }
  }

  await locked(async () => {
    const [allow, history] = await Promise.all([
      sget("allow", EMPTY_ALLOW()),
      hget(),
    ]);
    const now = Date.now();
    for (const [k, v] of Object.entries(allow.urls)) if (v < now) delete allow.urls[k];
    for (const r of restored) allow.tabs[r.tabId] = r.key;
    const done = new Set(restored.map((r) => r.entry.id));
    await Promise.all([
      sset("allow", allow),
      hset(history.filter((h) => !done.has(h.id))),
    ]);
  });
  return restored.length;
}

/* ---------- toolbar button behaviour ---------- */

async function applyIconBehaviour() {
  const s = await getSettings();
  let popup = "popup.html";
  if (s.iconAction !== "menu") {
    popup = s.iconConfirm ? `confirm.html?mode=${s.iconAction}` : "";
  }
  try {
    await api.action.setPopup({ popup });
  } catch {}
}

// Shows how many tabs were just closed, then hands the badge back to the live count.
let flashUntil = 0;
async function flash(count) {
  try {
    flashUntil = Date.now() + 2500;
    await api.action.setBadgeBackgroundColor({ color: count ? "#16a34a" : "#6b7280" });
    await api.action.setBadgeText({ text: String(count) });
    setTimeout(refreshBadge, 2600);
  } catch {}
}

/* ---------- live count on the toolbar icon ---------- */

let badgeTimer;
function scheduleRefresh() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(refreshBadge, 250);
}

async function refreshBadge() {
  if (Date.now() < flashUntil) return;
  try {
    const s = await getSettings();
    const [all, cur] = await Promise.all([planClose("all"), planClose("current")]);

    if (s.showBadge && all.length) {
      await api.action.setBadgeBackgroundColor({ color: "#ea580c" });
      try {
        await api.action.setBadgeTextColor({ color: "#ffffff" });
      } catch {}
      await api.action.setBadgeText({ text: all.length > 99 ? "99+" : String(all.length) });
    } else {
      await api.action.setBadgeText({ text: "" });
    }

    await api.action.setTitle({
      title: all.length
        ? `Duplicate Tab Closer - ${all.length} duplicate tab${all.length === 1 ? "" : "s"}`
        : "Duplicate Tab Closer - no duplicates",
    });
    updateMenuCounts(all.length, cur.length);
  } catch {}
}

/* ---------- right-click menu on the toolbar icon ---------- */

const menuLabel = (e) =>
  (e.title || e.url).replace(/[%&]/g, " ").trim().slice(0, 60) || "Untitled";

let menuTimer;
let menuChain = Promise.resolve();
function scheduleMenus() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    menuChain = menuChain.then(buildMenus).catch(() => {});
  }, 300);
}

async function buildMenus() {
  const menus = api.contextMenus;
  if (!menus) return;
  const items = await hget();
  const dupes = items.filter((e) => e.reason === "duplicate");
  const contexts = ["action"];
  await menus.removeAll();
  menus.create({ id: "close-all", title: "Close all duplicates", contexts });
  menus.create({ id: "close-current", title: "Close duplicates of this tab", contexts });
  menus.create({ id: "sep1", type: "separator", contexts });
  menus.create({
    id: "undo",
    title: dupes.length ? `Reopen last closed duplicate (${dupes.length})` : "Reopen last closed duplicate",
    enabled: dupes.length > 0,
    contexts,
  });
  menus.create({ id: "recent", title: "Recently closed", enabled: items.length > 0, contexts });
  for (const e of items.slice(0, 10)) {
    menus.create({ id: `recent:${e.id}`, parentId: "recent", title: menuLabel(e), contexts });
  }
  if (items.length) {
    menus.create({ id: "recent-sep", parentId: "recent", type: "separator", contexts });
    menus.create({ id: "clear-history", parentId: "recent", title: "Clear list", contexts });
  }
  menus.create({ id: "sep2", type: "separator", contexts });
  menus.create({ id: "history", title: "Full closed tab history", contexts });
  scheduleRefresh(); // re-apply the counts in the first two titles
}

function updateMenuCounts(all, cur) {
  const menus = api.contextMenus;
  if (!menus) return;
  const set = (id, title, enabled) => {
    try {
      const r = menus.update(id, { title, enabled });
      if (r?.catch) r.catch(() => {});
    } catch {}
  };
  set("close-all", all ? `Close all duplicates (${all})` : "Close all duplicates", all > 0);
  set("close-current", cur ? `Close duplicates of this tab (${cur})` : "Close duplicates of this tab", cur > 0);
}

async function undoNext() {
  // One tab at a time, newest closed duplicate first, working back through history.
  const next = (await hget()).find((e) => e.reason === "duplicate");
  return next ? restoreEntries([next], true) : 0;
}

api.contextMenus?.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  if (id === "close-all") flash(await execute("all", tab));
  else if (id === "close-current") flash(await execute("current", tab));
  else if (id === "undo") await undoNext();
  else if (id === "history") api.tabs.create({ url: api.runtime.getURL("history.html") });
  else if (id === "clear-history") await clearHistory();
  else if (id.startsWith("recent:")) {
    const entry = (await hget()).find((e) => e.id === id.slice(7));
    if (entry) await restoreEntries([entry], true);
  }
});

// Only fires when the popup is empty (iconAction "all"/"current" without confirmation).
api.action.onClicked.addListener(async (tab) => {
  const s = await getSettings();
  if (s.iconAction === "menu") return;
  flash(await execute(s.iconAction, tab));
});

/* ---------- events ---------- */

// Deliberate "Duplicate" detection. Browsers put a duplicated tab directly beside its
// source, but do not reliably report the source as the opener (Chrome gives the copy the
// source's own opener). So at creation we record the neighbouring tab on its left and the
// opener, then treat the new tab as a deliberate duplicate if either has the same URL.
// Runs inside the lock so the decision is made before the tab's first onUpdated is handled.
const DUP_WINDOW_MS = 30000;

async function flagIfDeliberate(tabId, key, candidates) {
  for (const id of candidates) {
    if (id === undefined) continue;
    try {
      const other = await api.tabs.get(id);
      if (isCheckable(other.url) && groupKey(other, await getSettings()) === key) {
        const allow = await sget("allow", EMPTY_ALLOW());
        allow.tabs[tabId] = key;
        await sset("allow", allow);
        return true;
      }
    } catch {
      // candidate tab is gone
    }
  }
  return false;
}

api.tabs.onCreated.addListener((tab) => {
  locked(async () => {
    const cache = await sget("cache", {});
    for (const o of Object.values(cache)) {
      if (o.windowId === tab.windowId && o.index >= tab.index) o.index++;
    }
    cache[tab.id] = tabInfo(tab);
    await sset("cache", cache);

    const s = await getSettings();
    if (s.closeManualDuplicates) return;

    let left;
    try {
      const siblings = await api.tabs.query({ windowId: tab.windowId });
      left = siblings.find((t) => t.index === tab.index - 1)?.id;
    } catch {}

    const created = await sget("created", {});
    const now = Date.now();
    for (const [k, v] of Object.entries(created)) if (now - v.t > 60000) delete created[k];
    created[tab.id] = { t: now, left, opener: tab.openerTabId };
    await sset("created", created);

    // The URL is often already known at creation; if not, checkTab finishes the job.
    const url = tab.url || tab.pendingUrl;
    if (isCheckable(url)) {
      await flagIfDeliberate(
        tab.id,
        groupKey({ url, incognito: tab.incognito }, s),
        [left, tab.openerTabId]
      );
    }
  });
});

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.url ||
    changeInfo.title ||
    changeInfo.favIconUrl ||
    changeInfo.status ||
    changeInfo.pinned !== undefined
  ) {
    cacheTab(tab);
  }
  if (changeInfo.status === "complete" || changeInfo.url) {
    if (tab.pinned) return;
    checkTab(tab);
  }
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.iconAction || changes.iconConfirm)) applyIconBehaviour();
  if (
    area === "local" &&
    (changes.showBadge || changes.whitelist || changes.ignoreHash || changes.ignoreQuery || changes.allWindows)
  ) {
    scheduleRefresh();
  }
  if (area === "local" && changes.persistHistory) {
    migrateHistory(!!changes.persistHistory.newValue).then(scheduleMenus);
  }
  if ((area === "session" || area === "local") && changes.history) scheduleMenus();
});

// Anything that can change how many duplicates are open refreshes the icon badge.
for (const e of [api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onActivated, api.tabs.onAttached, api.tabs.onDetached]) {
  e?.addListener(() => scheduleRefresh());
}
api.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.url || changeInfo.status || changeInfo.pinned !== undefined) scheduleRefresh();
});

// Tab positions drift when tabs are dragged or moved between windows; resync them.
let cacheTimer;
function scheduleCacheRebuild() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(rebuildCache, 150);
}
for (const e of [api.tabs.onMoved, api.tabs.onAttached, api.tabs.onDetached, api.tabs.onCreated, api.tabs.onRemoved]) {
  e?.addListener(() => scheduleCacheRebuild());
}
api.windows.onFocusChanged?.addListener(() => scheduleRefresh());

api.runtime.onInstalled.addListener(() => {
  applyIconBehaviour();
  rebuildCache();
  scheduleMenus();
  scheduleRefresh();
});
api.runtime.onStartup.addListener(() => {
  applyIconBehaviour();
  rebuildCache();
  scheduleMenus();
  scheduleRefresh();
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "execute":
        return { count: await execute(msg.mode) };
      case "plan": {
        const tabs = await planClose(msg.mode);
        return {
          count: tabs.length,
          items: tabs.slice(0, 20).map((t) => ({ title: t.title || t.url, url: t.url })),
        };
      }
      case "getHistory":
        return { items: await hget() };
      case "restore": {
        const history = await hget();
        const ids = new Set(msg.ids);
        const entries = history.filter((h) => ids.has(h.id)).reverse();
        return { count: await restoreEntries(entries, !!msg.activate && entries.length === 1) };
      }
      case "counts": {
        const [all, current] = await Promise.all([planClose("all"), planClose("current")]);
        return { all: all.length, current: current.length };
      }
      case "undoLast":
        return { count: await undoNext() };
      case "restoreDuplicates": {
        const history = await hget();
        const entries = history.filter((h) => h.reason === "duplicate").reverse();
        return { count: await restoreEntries(entries, false) };
      }
      case "clearHistory":
        await clearHistory();
        return { ok: true };
    }
    return {};
  })()
    .then(sendResponse)
    .catch(() => sendResponse({ count: 0, items: [] }));
  return true;
});

// Runs every time the background wakes up.
applyIconBehaviour();
rebuildCache();
scheduleMenus();
scheduleRefresh();
