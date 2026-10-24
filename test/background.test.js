// Logic tests for src/background.js, run against an in-memory fake of the browser APIs.
// Run with: npm test

const assert = require("node:assert");
const { test } = require("node:test");
const path = require("node:path");

/* ---------- fake browser ---------- */

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    fire: (...args) => Promise.all(listeners.map((fn) => fn(...args))),
  };
}

const store = { local: {}, session: {} };

function makeArea(name) {
  return {
    get: async (defaults) => {
      const out = {};
      for (const [key, fallback] of Object.entries(defaults)) {
        out[key] = key in store[name] ? store[name][key] : fallback;
      }
      return out;
    },
    set: async (values) => {
      const changes = {};
      for (const key of Object.keys(values)) changes[key] = { newValue: values[key] };
      Object.assign(store[name], JSON.parse(JSON.stringify(values)));
      global.chrome.storage.onChanged.fire(changes, name);
    },
    remove: async (key) => {
      delete store[name][key];
    },
  };
}

let tabs = [];
let nextId = 1;
const reindex = () => tabs.forEach((t, i) => (t.index = i));

const tabEvents = {
  onCreated: makeEvent(),
  onRemoved: makeEvent(),
  onUpdated: makeEvent(),
  onActivated: makeEvent(),
  onAttached: makeEvent(),
  onDetached: makeEvent(),
  onMoved: makeEvent(),
};
const onMessage = makeEvent();
const recorded = { badge: [], title: [], menus: [] };

global.chrome = {
  storage: { local: makeArea("local"), session: makeArea("session"), onChanged: makeEvent() },
  runtime: {
    onMessage,
    onInstalled: makeEvent(),
    onStartup: makeEvent(),
    getURL: (p) => p,
  },
  action: {
    setPopup: async () => {},
    setBadgeText: async ({ text }) => recorded.badge.push(text),
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
    setTitle: async ({ title }) => recorded.title.push(title),
    onClicked: makeEvent(),
  },
  contextMenus: {
    removeAll: async () => {
      recorded.menus = [];
    },
    create: (item) => recorded.menus.push(item),
    update: async () => {},
    onClicked: makeEvent(),
  },
  windows: {
    getLastFocused: async () => ({ id: 1 }),
    update: async () => {},
    onFocusChanged: makeEvent(),
  },
  tabs: {
    ...tabEvents,
    query: async (q) =>
      tabs
        .filter((t) => q.windowId === undefined || t.windowId === q.windowId)
        .filter((t) => q.active === undefined || t.active === q.active)
        .map((t) => ({ ...t })),
    get: async (id) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) throw new Error("no such tab");
      return { ...tab };
    },
    update: async () => {},
    remove: async (ids) => {
      for (const id of [].concat(ids)) {
        tabs = tabs.filter((t) => t.id !== id);
        reindex();
        await tabEvents.onRemoved.fire(id);
      }
    },
    create: async (props) => {
      const tab = {
        id: nextId++,
        windowId: 1,
        active: !!props.active,
        pinned: !!props.pinned,
        url: props.url,
        title: props.url,
      };
      if (tab.active) tabs.forEach((t) => (t.active = false));
      if (props.index !== undefined) tabs.splice(Math.min(props.index, tabs.length), 0, tab);
      else tabs.push(tab);
      reindex();
      await tabEvents.onCreated.fire({ ...tab });
      await tabEvents.onUpdated.fire(tab.id, { status: "complete" }, { ...tab });
      return { ...tab };
    },
  },
};

/* ---------- helpers ---------- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(30);

// Adds a tab the way a user action would: the created event fires, but no load events yet.
async function open(url, options = {}) {
  const { at, ...rest } = options;
  const tab = { id: nextId++, windowId: 1, active: false, pinned: false, url, title: url, ...rest };
  if (tab.active) tabs.forEach((t) => (t.active = false));
  if (at === undefined) tabs.push(tab);
  else tabs.splice(at, 0, tab);
  reindex();
  await tabEvents.onCreated.fire({ ...tab });
  return tab;
}

// Fires an update event and lets the extension react, as separate browser events would be.
async function update(tab, changeInfo) {
  await tabEvents.onUpdated.fire(tab.id, changeInfo, { ...tab });
  await settle();
}

const send = (message) => new Promise((resolve) => onMessage.listeners[0](message, {}, resolve));
const history = async () => (await send({ type: "getHistory" })).items;
const urls = () => tabs.map((t) => t.url);
const alive = (tab) => tabs.some((t) => t.id === tab.id);

async function reset(settings = {}) {
  tabs = [];
  store.session = {};
  delete store.local.history;
  await chrome.storage.local.set({
    autoClose: true,
    closeManualDuplicates: false,
    closeWhich: "right",
    persistHistory: false,
    ...settings,
  });
}

require(path.join(__dirname, "..", "src", "background.js"));

/* ---------- tests ---------- */

test("bulk close keeps pinned tabs and records duplicates in history", async () => {
  await reset({ autoClose: false });
  await open("https://a.com/#x");
  await open("https://a.com/#y");
  await open("https://b.com");
  await open("https://b.com", { pinned: true });
  await open("https://c.com");
  await settle();

  assert.strictEqual((await send({ type: "plan", mode: "all" })).count, 2);
  assert.strictEqual((await send({ type: "execute", mode: "all" })).count, 2);
  await settle();

  assert.strictEqual(tabs.length, 3);
  assert.ok(tabs.some((t) => t.pinned));
  const items = await history();
  assert.strictEqual(items.length, 2);
  assert.ok(items.every((e) => e.reason === "duplicate"));
});

test("reopen steps back one tab at a time and restored tabs are not re-closed", async () => {
  await reset({ autoClose: false });
  await open("https://a.com");
  await open("https://a.com");
  await open("https://b.com");
  await open("https://b.com");
  await settle();
  await send({ type: "execute", mode: "all" });
  await settle();
  await chrome.storage.local.set({ autoClose: true });
  assert.strictEqual((await send({ type: "counts" })).all, 0);

  assert.strictEqual((await send({ type: "undoLast" })).count, 1);
  await settle();
  assert.strictEqual(tabs.length, 3);
  assert.strictEqual((await history()).length, 1);

  assert.strictEqual((await send({ type: "undoLast" })).count, 1);
  await settle();
  assert.strictEqual(tabs.length, 4, "auto-close must leave restored tabs alone");
  assert.strictEqual((await send({ type: "undoLast" })).count, 0);
  assert.strictEqual((await history()).length, 0);
  assert.strictEqual((await send({ type: "counts" })).all, 2);
});

test("auto-close removes a new duplicate and records it", async () => {
  await reset();
  await open("https://c.com");
  await open("https://filler.com");
  const dup = await open("https://c.com");
  await update(dup, { status: "complete" });

  assert.ok(!alive(dup));
  assert.strictEqual((await history()).length, 1);
});

test("tabs closed by the user are recorded as closed", async () => {
  await reset({ autoClose: false });
  const solo = await open("https://solo.com", { title: "Solo" });
  await settle();
  await chrome.tabs.remove(solo.id);
  await settle();

  const [entry] = await history();
  assert.strictEqual(entry.url, "https://solo.com");
  assert.strictEqual(entry.reason, "closed");
});

test("closing duplicates of the current tab leaves other duplicates alone", async () => {
  await reset({ autoClose: false });
  await open("https://d.com", { active: true });
  await open("https://d.com");
  await open("https://e.com");
  await open("https://e.com");
  await settle();

  assert.strictEqual((await send({ type: "execute", mode: "current" })).count, 1);
  assert.strictEqual(tabs.filter((t) => t.url === "https://e.com").length, 2);
});

test("a duplicate made with right-click Duplicate is kept when its URL is unknown at creation", async () => {
  await reset();
  const original = await open("https://dup.com", { active: true });
  await update(original, { status: "complete" });
  await open("https://z.com");
  const copy = await open("", { at: 1 });
  copy.url = "https://dup.com";
  await update(copy, { url: "https://dup.com" });
  await update(copy, { status: "complete" });

  assert.ok(alive(copy));
  assert.ok(alive(original));
});

test("a duplicate is kept when its URL is known at creation", async () => {
  await reset();
  const original = await open("https://dup.com", { active: true });
  await update(original, { status: "complete" });
  await open("https://z.com");
  const copy = await open("https://dup.com", { at: 1 });
  await update(copy, { status: "complete" });

  assert.ok(alive(copy));
});

test("a duplicate with an unrelated inherited opener is kept, and reloads close nothing", async () => {
  await reset();
  const other = await open("https://other.com");
  const original = await open("https://dup.com", { active: true });
  await update(original, { status: "complete" });
  const copy = await open("https://dup.com", { at: 2, openerTabId: other.id });
  await update(copy, { status: "complete" });
  assert.ok(alive(copy));

  await update(original, { status: "complete" });
  await update(copy, { status: "complete" });
  assert.ok(alive(original) && alive(copy));
});

test("a same-URL tab opened away from its twin is still auto-closed", async () => {
  await reset();
  const original = await open("https://dup.com");
  await update(original, { status: "complete" });
  await open("https://filler.com");
  const stray = await open("https://dup.com");
  await update(stray, { status: "complete" });

  assert.ok(!alive(stray));
});

test("duplicates are auto-closed when the option is switched on", async () => {
  await reset({ closeManualDuplicates: true });
  const original = await open("https://dup.com");
  await update(original, { status: "complete" });
  const copy = await open("https://dup.com", { at: 1 });
  await update(copy, { status: "complete" });

  assert.ok(!alive(copy));
});

test("the toolbar badge shows the live count and the icon click closes duplicates", async () => {
  await reset({ autoClose: false });
  const first = await open("https://b.com");
  await open("https://b.com");
  await open("https://b.com");
  await open("https://c.com");
  await wait(900);

  assert.strictEqual(recorded.badge.at(-1), "2");
  assert.match(recorded.title.at(-1), /2 duplicate tabs/);

  await chrome.action.onClicked.fire({ id: first.id, windowId: 1, url: first.url });
  await settle();
  assert.strictEqual(tabs.filter((t) => t.url === "https://b.com").length, 1);

  await wait(3600);
  assert.strictEqual(recorded.badge.at(-1), "");
});

test("the right-click menu lists history and restores a tab", async () => {
  await wait(800);
  const ids = recorded.menus.map((m) => m.id);
  assert.ok(ids.includes("close-all") && ids.includes("undo") && ids.includes("history"));
  assert.strictEqual(recorded.menus.find((m) => m.id === "undo").enabled, true);

  const recent = recorded.menus.find((m) => m.id.startsWith("recent:"));
  assert.ok(recent);
  const before = tabs.length;
  await chrome.contextMenus.onClicked.fire({ menuItemId: recent.id }, undefined);
  await settle();
  assert.strictEqual(tabs.length, before + 1);
});

test("a reopened tab returns to the position it was closed from", async () => {
  await reset({ autoClose: false });
  const opened = [];
  for (const n of [1, 2, 3, 4]) opened.push(await open(`https://p${n}.com`));
  await settle();
  await chrome.tabs.remove(opened[2].id);
  await settle();

  const [entry] = await history();
  assert.strictEqual(entry.index, 2);
  await send({ type: "restore", ids: [entry.id] });
  await settle();
  assert.deepStrictEqual(urls(), ["https://p1.com", "https://p2.com", "https://p3.com", "https://p4.com"]);
});

test("swept duplicates land back in their slots and the rightmost ones close again", async () => {
  await reset({ autoClose: false });
  for (const name of ["a", "b", "a", "c", "a"]) await open(`https://${name}.com`);
  await settle();
  await send({ type: "execute", mode: "all" });
  await settle();
  assert.deepStrictEqual(urls(), ["https://a.com", "https://b.com", "https://c.com"]);

  await send({ type: "undoLast" });
  await settle();
  await send({ type: "undoLast" });
  await settle();
  assert.deepStrictEqual(urls(), [
    "https://a.com",
    "https://b.com",
    "https://a.com",
    "https://c.com",
    "https://a.com",
  ]);

  assert.strictEqual((await send({ type: "execute", mode: "all" })).count, 2);
  await settle();
  assert.deepStrictEqual(urls(), ["https://a.com", "https://b.com", "https://c.com"]);
});

test("the close-which setting decides which duplicate survives", async () => {
  async function run(closeWhich, activeIndex) {
    await reset({ autoClose: false, closeWhich });
    const older = await open("https://w.com", { active: activeIndex === 1 });
    const leftmost = await open("https://w.com", { at: 0, active: activeIndex === 2 });
    await settle();
    await send({ type: "execute", mode: "all" });
    await settle();
    assert.strictEqual(tabs.length, 1);
    return { survivor: tabs[0].id, older: older.id, leftmost: leftmost.id };
  }

  let result = await run("right");
  assert.strictEqual(result.survivor, result.leftmost, "right keeps the leftmost");
  result = await run("newest");
  assert.strictEqual(result.survivor, result.older, "newest closes the most recently opened");
  result = await run("active", 1);
  assert.strictEqual(result.survivor, result.older, "active keeps the active tab");
  result = await run("active", 2);
  assert.strictEqual(result.survivor, result.leftmost, "active keeps the active tab");
});

test("history is kept on disk only when the option is on", async () => {
  await reset({ autoClose: false });
  await open("https://k.com");
  await open("https://k.com");
  await settle();
  await chrome.storage.local.set({ persistHistory: true });
  await settle();
  await send({ type: "execute", mode: "all" });
  await settle();
  assert.strictEqual((store.local.history || []).length, 1);

  store.session = {}; // a browser restart
  assert.strictEqual((await history()).length, 1);

  await chrome.storage.local.set({ persistHistory: false });
  await settle();
  assert.strictEqual(store.local.history, undefined);
  assert.strictEqual((store.session.history || []).length, 1);
});

test("clearing the history leaves no trace of closed tabs", async () => {
  await reset({ autoClose: false });
  await open("https://staysopen.example/");
  await open("https://secret-closed.example/page");
  await open("https://secret-closed.example/page");
  await settle();
  await send({ type: "execute", mode: "all" });
  await settle();
  await send({ type: "undoLast" });
  await settle();
  for (const tab of tabs.filter((t) => t.url.includes("secret-closed"))) {
    await chrome.tabs.remove(tab.id);
  }
  await settle();

  // leftovers a timing race could create
  store.session.cache["9999"] = { url: "https://secret-stale.example/", title: "", index: 0, windowId: 1 };
  store.session.closing = {
    9998: { reason: "duplicate", info: { url: "https://secret-closing.example/" }, t: Date.now() },
  };
  assert.ok((await history()).length > 0);

  await send({ type: "clearHistory" });
  await settle();
  const dump = JSON.stringify(store);
  for (const needle of ["secret-closed", "secret-stale", "secret-closing"]) {
    assert.ok(!dump.includes(needle), `${needle} should be gone`);
  }
  assert.ok(dump.includes("staysopen"), "open tabs stay tracked");
  assert.strictEqual((await history()).length, 0);
});

test("stale tab cache entries age out on their own", async () => {
  store.session.cache["7777"] = { url: "https://secret-stale2.example/", index: 0, windowId: 1 };
  await chrome.tabs.onMoved.fire(1, {});
  await wait(250);
  await chrome.tabs.onMoved.fire(1, {});
  await wait(250);
  assert.ok(!JSON.stringify(store.session).includes("secret-stale2"));
});
