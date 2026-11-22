const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get("mode") === "current" ? "current" : "all";

(async () => {
  const { count, items = [] } = await api.runtime.sendMessage({ type: "plan", mode });
  const what = mode === "current" ? "duplicates of this tab" : "duplicate tabs";

  if (!count) {
    $("title").textContent = mode === "current" ? "No duplicates of this tab" : "No duplicates found";
    $("cancel").textContent = "OK";
    $("dontAsk").parentElement.hidden = true;
    return;
  }

  $("title").textContent = `Close ${count} ${count === 1 ? what.replace(/s\b/, "") : what}?`;
  for (const it of items.slice(0, 6)) {
    const li = document.createElement("li");
    li.textContent = it.title;
    li.title = it.url;
    $("list").appendChild(li);
  }
  if (count > 6) {
    const li = document.createElement("li");
    li.textContent = `...and ${count - 6} more`;
    li.style.opacity = ".6";
    $("list").appendChild(li);
  }

  $("ok").hidden = false;
  $("ok").focus();
  $("ok").addEventListener("click", async () => {
    if ($("dontAsk").checked) await api.storage.local.set({ iconConfirm: false });
    const res = await api.runtime.sendMessage({ type: "execute", mode });
    $("title").textContent = `Closed ${res.count}`;
    $("list").textContent = "";
    $("ok").hidden = true;
    $("cancel").hidden = true;
    setTimeout(() => window.close(), 700);
  });
})();

$("cancel").addEventListener("click", () => window.close());
