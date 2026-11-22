const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const send = (msg) => api.runtime.sendMessage(msg);

let all = [];

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

function shown() {
  const q = $("q").value.trim().toLowerCase();
  const f = $("filter").value;
  return all.filter((e) => {
    if (f !== "all" && e.reason !== f) return false;
    if (q && !(e.title || "").toLowerCase().includes(q) && !e.url.toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  const list = $("list");
  list.textContent = "";
  const items = shown();
  $("restoreShown").disabled = !items.length;
  $("restoreDupes").disabled = !all.some((e) => e.reason === "duplicate");
  $("clear").disabled = !all.length;

  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = all.length ? "No matches" : "Nothing closed yet this session";
    list.appendChild(li);
    return;
  }

  for (const e of items) {
    const li = document.createElement("li");

    if (e.favIconUrl) {
      const img = document.createElement("img");
      img.src = e.favIconUrl;
      img.onerror = () => img.remove();
      li.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "ph";
      li.appendChild(ph);
    }

    const txt = document.createElement("div");
    txt.className = "txt";
    const b = document.createElement("b");
    b.textContent = e.title || e.url;
    const small = document.createElement("small");
    small.textContent = e.url;
    txt.append(b, small);
    li.appendChild(txt);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = ago(e.closedAt);
    if (e.reason === "duplicate") {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "duplicate";
      meta.appendChild(tag);
    }
    li.appendChild(meta);

    const btn = document.createElement("button");
    btn.textContent = "Reopen";
    btn.addEventListener("click", () => send({ type: "restore", ids: [e.id], activate: true }));
    li.appendChild(btn);

    list.appendChild(li);
  }
}

async function load() {
  ({ items: all } = await send({ type: "getHistory" }));
  render();
}

$("q").addEventListener("input", render);
$("filter").addEventListener("change", render);
$("restoreShown").addEventListener("click", () =>
  send({ type: "restore", ids: shown().map((e) => e.id) })
);
$("restoreDupes").addEventListener("click", () => send({ type: "restoreDuplicates" }));
$("clear").addEventListener("click", () => {
  if (confirm("Clear the closed tab history for this session?")) send({ type: "clearHistory" });
});

api.storage.onChanged.addListener((changes, area) => {
  if ((area === "session" || area === "local") && changes.history) load();
});

load();
setInterval(render, 30000); // keep the "x min ago" labels fresh
