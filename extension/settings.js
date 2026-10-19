(() => {
  // Reloading an extension invalidates its old isolated world. Re-injection
  // reconnects storage without restarting the map's MAIN-world UI scripts.
  try { globalThis.__aeSettingsCleanup?.(); } catch { /* The old context may be invalid. */ }
  const defaults = { display: "labels", position: "top", language: "zh" };
  const allowed = {
    display: ["labels", "compact"],
    position: ["top", "left"],
    language: ["zh", "ja"],
  };
  let disposed = false;
  const changesWhileReading = {};

  function applyValue(key, value) {
    const valid = allowed[key].includes(value);
    const attribute = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const name = `data-ae-${attribute}`;
    const normalized = String(valid ? value : defaults[key]);
    if (document.documentElement.getAttribute(name) !== normalized) {
      document.documentElement.setAttribute(name, normalized);
    }
  }

  function apply(settings = {}) {
    for (const [key, fallback] of Object.entries(defaults)) {
      applyValue(key, settings[key] ?? fallback);
    }
  }

  function onChanged(changes, area) {
    if (disposed || area !== "local") return;
    for (const key of Object.keys(defaults)) {
      if (key in changes) {
        changesWhileReading[key] = changes[key].newValue;
        applyValue(key, changes[key].newValue);
      }
    }
  }

  globalThis.__aeSettingsCleanup = () => {
    disposed = true;
    chrome.storage.onChanged.removeListener(onChanged);
  };
  chrome.storage.onChanged.addListener(onChanged);
  const root = document.documentElement;
  if (!root.hasAttribute("data-ae-works-hidden")) {
    const upgrading = root.dataset.aeReady === "true" || !!document.querySelector(".ae-scroller");
    const visible = [...document.querySelectorAll(".window-bangumis-box")].some(node =>
      !node.hidden && node.getBoundingClientRect().height > 0 && node.getClientRects().length
      && getComputedStyle(node).visibility !== "hidden");
    root.dataset.aeWorksHidden = String(upgrading && !visible);
    if (upgrading) root.dataset.aeWorksMigrated = "true";
  }
  // The old MAIN-world region controller cannot be disposed on an existing
  // page. Removing its threshold leaves it at the native handoff (12), where
  // it no longer creates a replacement list; the new controller owns visibility.
  root.removeAttribute("data-ae-min-zoom");
  // Retain the CSS bridge for existing tabs, but ignore legacy manual themes.
  document.documentElement.dataset.aeTheme = "system";
  if (!document.documentElement.hasAttribute("data-ae-display")) apply();
  return chrome.storage.local.get(defaults).then(async (settings) => {
    if (disposed) return { applied: false };
    apply({ ...settings, ...changesWhileReading });
    await chrome.storage.local.remove("minZoom");
    return {
      applied: true,
      // Older releases have no ready marker, but their existing scroller proves
      // the UI is already running and only the settings bridge needs repair.
      ready: document.documentElement.dataset.aeReady === "true" || !!document.querySelector(".ae-scroller"),
    };
  }).catch(() => ({ applied: false }));
})();
