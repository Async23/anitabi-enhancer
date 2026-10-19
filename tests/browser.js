import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
const { chromium } = await import("@playwright/test");
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function launchBrowser(options = {}) {
  const extension = path.join(projectRoot, "extension");
  return chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1367, height: 902 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-extension-debugging"],
    ...options,
  });
}

export async function openPageSettings(page) {
  const panel = page.getByRole("dialog", { name: "作品设置" });
  if (!await panel.isVisible()) await page.getByRole("button", { name: "作品设置", exact: true }).click();
  return panel;
}

export async function openMarkerMenu(page) {
  const menu = page.getByRole("dialog", { name: "地图标记" });
  if (!await menu.isVisible()) await page.getByRole("button", { name: "地图标记", exact: true }).click();
  return menu;
}

export async function setMarkerVisible(page, name, visible) {
  const menu = await openMarkerMenu(page);
  await menu.getByRole("checkbox", { name, exact: true }).setChecked(visible);
  return menu;
}

export async function setPreference(page, name, value) {
  const panel = await openPageSettings(page);
  await panel.locator(`input[name="${name}"][value="${value}"]`).locator("..").click();
  await page.waitForFunction(({ name, value }) => document.documentElement.getAttribute(`data-ae-${name}`) === value, { name, value });
  await panel.getByRole("button", { name: "收起" }).click();
}

export async function extensionWorker(context) {
  return context.serviceWorkers().find((worker) => worker.url().endsWith("/background.js"))
    || await context.waitForEvent("serviceworker", { predicate: (worker) => worker.url().endsWith("/background.js") });
}

export async function triggerAction(context, page, id = undefined) {
  id ||= await extensionId(context);
  const session = await context.browser().newBrowserCDPSession();
  try {
    const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab" }, { exclude: true }] });
    const target = targetInfos.find((item) => item.url === page.url());
    if (!target) throw new Error("No browser tab for the test page");
    // A real toolbar click belongs to the active tab. Chromium's triggerAction
    // currently delivers that tab even when targetId names an inactive one.
    await session.send("Target.activateTarget", { targetId: target.targetId });
    await session.send("Extensions.triggerAction", { id, targetId: target.targetId });
  } finally { await session.detach(); }
}

export async function extensionId(context) {
  const manager = await context.newPage();
  try {
    await manager.goto("chrome://extensions");
    const items = await manager.evaluate(() => new Promise((resolve) => {
      chrome.developerPrivate.getExtensionsInfo({ includeDisabled: false }, resolve);
    }));
    const extension = items.find((item) => item.name === "Anitabi 增强");
    if (!extension) throw new Error("扩展未成功加载");
    if (extension.manifestErrors?.length) throw new Error(JSON.stringify(extension.manifestErrors));
    return extension.id;
  } finally {
    await manager.close();
  }
}

export async function reloadExtension(context, id) {
  const manager = await context.newPage();
  try {
    await manager.goto("chrome://extensions");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await manager.evaluate((extensionId) => new Promise((resolve, reject) => {
      const onChanged = (event) => {
        if (event.item_id !== extensionId || event.event_type !== "LOADED") return;
        chrome.developerPrivate.onItemStateChanged.removeListener(onChanged);
        resolve();
      };
      chrome.developerPrivate.onItemStateChanged.addListener(onChanged);
      chrome.developerPrivate.reload(extensionId, { failQuietly: true }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          chrome.developerPrivate.onItemStateChanged.removeListener(onChanged);
          reject(new Error(error.message));
        }
      });
    }), id);
  } finally {
    await manager.close();
  }
}
