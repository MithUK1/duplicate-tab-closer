const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

let statusTimer;
function say(text) {
  $("status").textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($("status").textContent = ""), 4000);
}

const tabs = (n) => `${n} tab${n === 1 ? "" : "s"}`;

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function showView(name) {
  $("main").hidden = name !== "main";
  $("sub").hidden = name !== "sub";
}

function faviconEl(e) {
  if (e.favIconUrl) {
    const img = document.createElement("img");
    img.src = e.favIconUrl;
    img.onerror = () => img.replaceWith(Object.assign(document.createElement("div"), { className: "ph" }));
    return img;
  }
  return Object.assign(document.createElement("div"), { className: "ph" });
}

async function refresh() {
  const [{ items = [] }, counts] = await Promise.all([
    send({ type: "getHistory" }),
    send({ type: "counts" }),
  ]);

  // How many tabs each button will close.
  const all = counts?.all ?? 0;
  const cur = counts?.current ?? 0;
  $("allCount").textContent = all;
  $("curCount").textContent = cur;
  $("closeAll").disabled = !all;
  $("closeCurrent").disabled = !cur;
  $("summary").textContent = all
    ? `${all} duplicate ${all === 1 ? "tab" : "tabs"} open`
    : "No duplicates open";

  // Reopen steps back through closed duplicates one at a time.
  const dupes = items.filter((e) => e.reason === "duplicate");
  $("undo").disabled = !dupes.length;
  $("undoCount").textContent = dupes.length;
  $("undoCount").hidden = !dupes.length;
  $("undoNext").textContent = dupes.length
    ? dupes[0].title || host(dupes[0].url)
    : "Nothing to reopen";

  $("recentCount").textContent = items.length ? items.length : "";
  $("clear").disabled = !items.length;

  const list = $("recent");
  list.textContent = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing closed yet this session";
    list.appendChild(li);
    return;
  }
  for (const e of items.slice(0, 25)) {
    const li = document.createElement("li");
    li.title = e.url;
    li.appendChild(faviconEl(e));

    const txt = document.createElement("div");
    txt.className = "txt";
    const b = document.createElement("b");
    b.textContent = e.title || host(e.url);
    const small = document.createElement("small");
    small.textContent = host(e.url);
    txt.append(b, small);
    li.appendChild(txt);

    const when = document.createElement("span");
    when.className = "when";
    when.textContent = ago(e.closedAt);
    li.appendChild(when);

    li.addEventListener("click", async () => {
      await send({ type: "restore", ids: [e.id], activate: true });
      refresh();
    });
    list.appendChild(li);
  }
}

(async () => {
  const { autoClose = true } = await api.storage.local.get({ autoClose: true });
  $("autoClose").checked = autoClose;
  $("autoClose").addEventListener("change", () =>
    api.storage.local.set({ autoClose: $("autoClose").checked })
  );
  refresh();
})();

$("closeAll").addEventListener("click", async () => {
  const { count } = await send({ type: "execute", mode: "all" });
  say(count ? `Closed ${tabs(count)}` : "No duplicates found");
  refresh();
});

$("closeCurrent").addEventListener("click", async () => {
  const { count } = await send({ type: "execute", mode: "current" });
  say(count ? `Closed ${tabs(count)}` : "No duplicates of this tab");
  refresh();
});

$("undo").addEventListener("click", async () => {
  const { count } = await send({ type: "undoLast" });
  say(count ? "Reopened last closed duplicate" : "Nothing to reopen");
  refresh();
});

$("openRecent").addEventListener("click", () => showView("sub"));
$("back").addEventListener("click", () => showView("main"));

$("clear").addEventListener("click", async () => {
  await send({ type: "clearHistory" });
  say("History cleared");
  refresh();
});

const openHistory = () => {
  api.tabs.create({ url: api.runtime.getURL("history.html") });
  window.close();
};
$("history").addEventListener("click", openHistory);
$("history2").addEventListener("click", openHistory);

$("settings").addEventListener("click", () => {
  api.runtime.openOptionsPage();
  window.close();
});
