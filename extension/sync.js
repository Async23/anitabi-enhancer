// Reconnect settings without restarting the work list or losing its selection.
const syncQueues = new Map();
globalThis.__aeSyncMaps = async ({ tabId, openSettings = false } = {}) => {
  const matches = chrome.runtime.getManifest().host_permissions;
  const tabs = (await chrome.tabs.query({ url: matches })).filter((tab) =>
    (tabId === undefined || tab.id === tabId) && /\/map(?:\/|$)/.test(new URL(tab.url).pathname));
  const results = await Promise.allSettled(tabs.map((tab) => {
    // Activation and a toolbar click can arrive together. A second bridge must
    // not dispose the first while it is still reading the saved preferences.
    const task = (syncQueues.get(tab.id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (tab.discarded || tab.frozen) return false;
      const [response] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["settings.js"] });
      if (!response?.result?.applied || !response.result.ready) return false;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["region.js", "map-dots.js", "map-symbols.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page-settings.js"] });
      if (openSettings) {
        const [opened] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
          const host = document.getElementById("ae-page-settings");
          host?.dispatchEvent(new Event("ae-settings-open"));
          return host?.dataset.open === "true";
        } });
        if (!opened?.result) return false;
      }
      return true;
    });
    syncQueues.set(tab.id, task);
    return task.finally(() => { if (syncQueues.get(tab.id) === task) syncQueues.delete(tab.id); });
  }));
  return { total: tabs.length, failed: results.some((result) => result.status === "rejected" || !result.value) };
};
