importScripts("sync.js");

// An unpacked-extension reload also fires onInstalled.
chrome.runtime.onInstalled.addListener(() => { globalThis.__aeSyncMaps().catch(() => {}); });
chrome.tabs.onActivated.addListener(({ tabId }) => { globalThis.__aeSyncMaps({ tabId }).catch(() => {}); });

async function openSettings(tabId) {
  const result = await globalThis.__aeSyncMaps({ tabId, openSettings: true });
  if (!result.total || result.failed) throw new Error("Map controls unavailable");
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: "作品设置" });
}

async function reportUnavailable(tabId) {
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b45309" });
  await chrome.action.setTitle({ tabId, title: "地图尚未就绪，请稍后再点；仍无响应时刷新地图重试" });
}

chrome.action.onClicked.addListener(async (tab) => {
  let target = tab;
  try {
    const matches = chrome.runtime.getManifest().host_permissions;
    const maps = (await chrome.tabs.query({ url: matches, windowId: tab.windowId }))
      .filter((item) => /\/map(?:\/|$)/.test(new URL(item.url).pathname));
    target = maps.find((item) => item.id === tab.id) || maps.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!target) target = await chrome.tabs.create({ windowId: tab.windowId, url: "https://www.anitabi.cn/map" });
    else if (!target.active) target = await chrome.tabs.update(target.id, { active: true });
    if (target.status === "loading") {
      await chrome.storage.session.set({ pendingSettingsTab: target.id });
      // A fast local/cache load can finish before the pending request is saved.
      if ((await chrome.tabs.get(target.id)).status !== "complete") return;
      await chrome.storage.session.remove("pendingSettingsTab");
    }
    await openSettings(target.id);
  } catch { await reportUnavailable(target?.id ?? tab.id).catch(() => {}); }
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== "complete") return;
  if ((await chrome.storage.session.get("pendingSettingsTab")).pendingSettingsTab !== tabId) return;
  await chrome.storage.session.remove("pendingSettingsTab");
  try { await openSettings(tabId); }
  catch { await reportUnavailable(tabId).catch(() => {}); }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await chrome.storage.session.get("pendingSettingsTab")).pendingSettingsTab === tabId) {
    await chrome.storage.session.remove("pendingSettingsTab");
  }
});
