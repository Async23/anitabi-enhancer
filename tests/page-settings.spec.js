import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchBrowser, extensionId, reloadExtension, openPageSettings, triggerAction, extensionWorker, openMarkerMenu, setMarkerVisible } from "./browser.js";

const html = await readFile(new URL("./site.html", import.meta.url), "utf8");
let context;
let page;
let panel;

test.beforeEach(async () => {
  context = await launchBrowser();
  await context.route("https://**/*", (route) => route.fulfill(route.request().resourceType() === "document"
    ? { contentType: "text/html", body: html }
    : { contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>' }));
  page = await context.newPage();
  await page.goto("https://www.anitabi.cn/map?z=13.2");
  await page.getByRole("button", { name: "作品设置", exact: true }).click();
  panel = page.getByRole("dialog", { name: "作品设置" });
  await expect(panel).toBeVisible();
});

test.afterEach(async () => { await context?.close(); });

test("页面设置一键切换，与其他地图同步且保留筛选", async () => {
  await panel.getByText("仅图标", { exact: true }).click();
  await expect(page.locator(".ae-name").first()).toBeHidden();
  await panel.getByText("左侧列表", { exact: true }).click();
  await expect(page.locator(".window-bangumis-box")).toHaveAttribute("data-ae-layout", "left");
  await panel.getByText("原名优先", { exact: true }).click();
  await expect(page.locator(".ae-item").first()).toHaveAttribute("title", /^ゴールデンカムイ/);
  await expect(panel.locator("#theme")).toHaveCount(0);
  const otherMap = await context.newPage();
  await otherMap.goto("https://w.anitabi.cn/map");
  const otherPanel = await openPageSettings(otherMap);
  for (const [name, value] of [["display", "compact"], ["position", "left"], ["language", "ja"]]) {
    await expect(otherPanel.locator(`input[name="${name}"][value="${value}"]`)).toBeChecked();
  }
  await expect(otherMap.locator("html")).toHaveAttribute("data-ae-theme", "system");
  await otherPanel.getByText("显示名称", { exact: true }).click();
  await otherPanel.getByText("顶部横排", { exact: true }).click();
  await expect(panel.getByRole("radio", { name: "显示名称" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "顶部横排" })).toBeChecked();
  await panel.getByText("中文优先", { exact: true }).click();
  await expect(otherPanel.getByRole("radio", { name: "中文优先" })).toBeChecked();
  await page.locator(".ae-item").first().click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "作品设置", exact: true }).click();
  await panel.getByText("左侧列表", { exact: true }).click();
  expect(await page.evaluate(() => originalClicks)).toEqual([221127]);
  await expect(page.locator(".ae-item").first()).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ae-position", "left");
  await expect(page.locator("#ae-page-settings")).toHaveCount(1);
});

test("移除缩放阈值，区域作品列表通过页面临时开关控制", async () => {
  await expect(panel.locator('input[type="number"]')).toHaveCount(0);
  await expect(panel.getByText("作品栏最低缩放级别")).toHaveCount(0);
  await setMarkerVisible(page, "区域作品列表", false);
  await expect(page.locator(".window-bangumis-box")).toBeHidden();
  const menu = await openMarkerMenu(page);
  await expect(menu.getByRole("checkbox")).toHaveCount(5);
  await expect(menu.getByRole("checkbox", { name: "地图作品名称" })).toBeChecked();
  const other = await context.newPage();
  await other.goto("https://w.anitabi.cn/map");
  await expect(other.locator(".window-bangumis-box")).toBeVisible();
  await page.reload();
  await expect(page.locator(".window-bangumis-box")).toBeVisible();
  await expect((await openMarkerMenu(page)).getByRole("checkbox", { name: "区域作品列表" })).toBeChecked();
});

test("页面面板的滚轮和键盘不会操作地图，支持 Esc、收起和点击外部关闭", async () => {
  await page.evaluate(() => {
    window.mapEvents = [];
    for (const type of ["wheel", "click", "keydown", "pointerdown"]) {
      document.addEventListener(type, () => mapEvents.push(type));
    }
  });
  await panel.getByText("仅图标", { exact: true }).click();
  const bounds = await panel.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 90);
  await page.mouse.wheel(0, 400);
  await panel.getByRole("radio", { name: "仅图标" }).focus();
  await page.keyboard.press("ArrowUp");
  expect(await page.evaluate(() => mapEvents)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "作品设置", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "作品设置", exact: true }).click();
  await panel.getByRole("button", { name: "收起" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "作品设置", exact: true }).click();
  await page.mouse.click(600, 400);
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => mapEvents)).toContain("pointerdown");
});

test("页面设置入口避开地图按钮，面板适应窄屏和矮窗口，不在其他页面显示", async () => {
  for (const [width, height] of [[1367, 902], [390, 844], [320, 320], [1367, 360]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => {
      const root = document.getElementById("ae-page-settings").shadowRoot;
      const button = root.getElementById("controls").getBoundingClientRect();
      const panel = root.getElementById("panel");
      const bounds = panel.getBoundingClientRect();
      const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const anchors = [...document.querySelectorAll(".mapboxgl-ctrl-group, .side-search-form")];
      return {
        entryInside: button.left >= 0 && button.right <= innerWidth && button.top >= 0 && button.bottom <= innerHeight,
        panelInside: bounds.left >= 12 && bounds.right <= innerWidth - 12 && bounds.top >= 12 && bounds.bottom <= innerHeight - 12,
        clearControls: anchors.every((node) => !overlaps(button, node.getBoundingClientRect())),
        noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth,
      };
    })).toEqual({ entryInside: true, panelInside: true, clearControls: true, noHorizontalOverflow: true });
  }
  await page.goto("https://www.anitabi.cn/");
  await expect(page.locator("#ae-page-settings")).toHaveCount(0);
  await page.goto("https://example.org/map");
  await expect(page.locator("#ae-page-settings")).toHaveCount(0);
});

test("重新加载扩展后页面入口自动恢复，没有重复控件且保留展开状态", async () => {
  await panel.getByText("左侧列表", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-ae-position", "left");
  const previous = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, await extensionId(context));
  await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
  await expect(panel).toBeVisible();
  await panel.getByText("顶部横排", { exact: true }).click();
  await panel.getByText("仅图标", { exact: true }).click();
  await expect(page.locator(".window-bangumis-box")).toHaveAttribute("data-ae-layout", "top");
  await expect(page.locator(".ae-name").first()).toBeHidden();
  await expect(page.locator("#ae-page-settings")).toHaveCount(1);
  await expect(page.locator(".ae-scroller")).toHaveCount(1);
  await expect(panel.getByRole("status")).toHaveText("已保存，立即生效");
});

test("工具栏图标直接打开同一个页面面板，没有独立弹窗", async () => {
  const host = await page.locator("#ae-page-settings").elementHandle();
  await panel.getByRole("button", { name: "收起" }).click();
  const count = context.pages().length;
  await triggerAction(context, page);
  await expect(panel).toBeVisible();
  expect(context.pages().length).toBe(count);
  expect(await host.evaluate(node => node.isConnected)).toBe(true);
  const worker = await extensionWorker(context);
  expect(await worker.evaluate(() => chrome.action.getPopup({}))).toBe("");
  await expect(page.locator("#ae-page-settings")).toHaveCount(1);
  const other = await context.newPage();
  await other.goto("https://example.org/");
  await panel.getByRole("button", { name: "收起" }).click();
  await triggerAction(context, other);
  await expect(panel).toBeVisible();
  expect(context.pages().length).toBe(count + 1);
});

test("没有地图标签页时，工具栏打开地图并展示设置", async () => {
  await page.goto("https://example.org/");
  const id = await extensionId(context);
  const created = context.waitForEvent("page");
  await triggerAction(context, page, id);
  const map = await created;
  await map.waitForURL("https://www.anitabi.cn/map");
  await expect(map.getByRole("dialog", { name: "作品设置" })).toBeVisible();
  await expect(map.locator("#ae-page-settings")).toHaveCount(1);
});
