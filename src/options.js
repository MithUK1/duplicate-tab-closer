const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  autoClose: true,
  ignoreHash: true,
  ignoreQuery: false,
  allWindows: true,
  keep: "existing",
  whitelist: "",
  totalClosed: 0,
  iconAction: "all",
  showBadge: true,
  iconConfirm: false,
  trackHistory: true,
  historyLimit: 500,
  historyMinutes: 5,
  closeManualDuplicates: false,
  closeWhich: "right",
  persistHistory: false,
};

let timer;
function flash() {
  $("saved").classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => $("saved").classList.remove("show"), 1200);
}

function save(key, value) {
  api.storage.local.set({ [key]: value }).then(flash);
}

function syncConfirmRow() {
  $("confirmRow").classList.toggle("disabled", $("iconAction").value === "menu");
}

(async () => {
  const s = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) };

  for (const key of ["autoClose", "ignoreHash", "ignoreQuery", "allWindows", "iconConfirm", "trackHistory", "closeManualDuplicates", "showBadge", "persistHistory"]) {
    const el = $(key);
    el.checked = s[key];
    el.addEventListener("change", () => save(key, el.checked));
  }

  for (const key of ["keep", "iconAction", "closeWhich"]) {
    const el = $(key);
    el.value = s[key];
    el.addEventListener("change", () => {
      save(key, el.value);
      syncConfirmRow();
    });
  }
  syncConfirmRow();

  const wl = $("whitelist");
  wl.value = s.whitelist;
  let wlTimer;
  wl.addEventListener("input", () => {
    clearTimeout(wlTimer);
    wlTimer = setTimeout(() => save("whitelist", wl.value), 400);
  });

  const lim = $("historyLimit");
  lim.value = s.historyLimit;
  lim.addEventListener("change", () => {
    const n = Math.min(2000, Math.max(20, parseInt(lim.value, 10) || DEFAULTS.historyLimit));
    lim.value = n;
    save("historyLimit", n);
  });

  const mins = $("historyMinutes");
  mins.value = s.historyMinutes;
  mins.addEventListener("change", () => {
    const n = Math.min(1440, Math.max(0, parseInt(mins.value, 10) || 0));
    mins.value = n;
    save("historyMinutes", n);
  });

  $("total").textContent = s.totalClosed;
  $("reset").addEventListener("click", () => api.storage.local.set({ totalClosed: 0 }));

  $("openHistory").addEventListener("click", () =>
    api.tabs.create({ url: api.runtime.getURL("history.html") })
  );
})();

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.totalClosed) {
    $("total").textContent = changes.totalClosed.newValue ?? 0;
  }
  // "Don't ask again" in the confirm popup flips this from elsewhere.
  if (area === "local" && changes.iconConfirm) {
    $("iconConfirm").checked = !!changes.iconConfirm.newValue;
  }
});
