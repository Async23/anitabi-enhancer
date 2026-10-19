import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchBrowser, extensionId, reloadExtension, setPreference, openMarkerMenu, setMarkerVisible } from "./browser.js";

const html = await readFile(new URL("./site.html", import.meta.url), "utf8");
let context;
let page;

async function installMap(page) {
  await page.evaluate(() => {
    const listeners = new Map();
    window.mapLayers = {
      "bangumi-point": { id: "bangumi-point", type: "circle", source: "points", layout: {}, filter: ["==", "aid", 221127] },
      bangumis: { id: "bangumis", type: "symbol", source: "bangumis", layout: { "text-field": "作品名称", "icon-image": "头像" } },
      stations: { id: "stations", type: "circle", source: "basemap", layout: {} },
    };
    window.emitMap = (name) => listeners.get(name)?.forEach(fn => fn());
    window.mapCalls = [];
    mapApp.map = {
      getLayer: id => mapLayers[id],
      addLayer(layer) { mapLayers[layer.id] = { layout: {}, ...layer }; emitMap("styledata"); },
      removeLayer(id) { delete mapLayers[id]; emitMap("styledata"); },
      getLayoutProperty: (id, name) => mapLayers[id]?.layout[name],
      setLayoutProperty(id, name, value) {
        mapCalls.push({ id, name, value });
        if (value === null) delete mapLayers[id].layout[name];
        else mapLayers[id].layout[name] = value;
        emitMap("styledata");
      },
      on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
      },
      off(name, fn) { listeners.get(name)?.delete(fn); },
    };
  });
}

test.beforeEach(async () => {
  context = await launchBrowser();
  await context.route("https://**/*", route => route.fulfill(route.request().resourceType() === "document"
    ? { contentType: "text/html", body: html }
    : { contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>' }));
  page = await context.newPage();
  await page.goto("https://www.anitabi.cn/map?z=11.7");
});
test.afterEach(async () => { await context?.close(); });

const visibility = () => page.evaluate(() => mapApp.map.getLayoutProperty("bangumi-point", "visibility") ?? null);

test("临时隐藏仅影响彩色圆点，保留头像、名称、底图、筛选并能完整恢复", async () => {
  await installMap(page);
  await page.locator(".ae-item").first().click();
  const original = await page.evaluate(() => structuredClone(mapLayers));
  await setMarkerVisible(page, "彩色圆点", false);
  await expect.poll(visibility).toBe("none");
  await expect(page.getByRole("checkbox", { name: "彩色圆点" })).not.toBeChecked();
  expect(await page.evaluate(() => mapLayers.bangumis)).toEqual(original.bangumis);
  expect(await page.evaluate(() => mapLayers.stations)).toEqual(original.stations);
  expect(await page.evaluate(() => mapLayers["bangumi-point"].filter)).toEqual(original["bangumi-point"].filter);
  expect(await page.evaluate(() => [...mapApp.selectedBangumiIds])).toEqual([221127]);
  await page.evaluate(() => { emitMap("moveend"); emitMap("idle"); });
  await expect.poll(visibility).toBe("none");
  await setMarkerVisible(page, "彩色圆点", true);
  await expect.poll(visibility).toBe(null);
  expect(await page.evaluate(() => mapLayers)).toEqual(original);
  expect(await page.evaluate(() => mapCalls.length)).toBe(2);
});

test("地图延迟初始化、图层重建及重新加载扩展后隐藏仍有效，恢复不强行显示原本隐藏的图层", async () => {
  await setMarkerVisible(page, "彩色圆点", false);
  await installMap(page);
  await expect.poll(visibility).toBe("none");
  await page.evaluate(() => {
    delete mapLayers["bangumi-point"];
    emitMap("styledata");
    mapLayers["bangumi-point"] = { id: "bangumi-point", type: "circle", source: "points", layout: { visibility: "visible" } };
    emitMap("style.load");
  });
  await expect.poll(visibility).toBe("none");
  const host = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, await extensionId(context));
  await expect.poll(() => host.evaluate(node => node.isConnected)).toBe(false);
  await setMarkerVisible(page, "彩色圆点", true);
  await expect.poll(visibility).toBe("visible");
  await page.evaluate(() => mapApp.map.setLayoutProperty("bangumi-point", "visibility", "none"));
  await setMarkerVisible(page, "彩色圆点", false);
  await setMarkerVisible(page, "彩色圆点", true);
  await expect.poll(visibility).toBe("none");
});

test("隐藏只限当前页面，刷新恢复圆点，已保存的展示偏好保留", async () => {
  await installMap(page);
  await setPreference(page, "position", "left");
  await setMarkerVisible(page, "彩色圆点", false);
  await setMarkerVisible(page, "作品头像", false);
  await setMarkerVisible(page, "地图作品名称", false);
  await expect.poll(visibility).toBe("none");
  const other = await context.newPage();
  await other.goto("https://w.anitabi.cn/map");
  await installMap(other);
  await expect((await openMarkerMenu(other)).getByRole("checkbox", { name: "彩色圆点" })).toBeChecked();
  await expect(other.getByRole("checkbox", { name: "作品头像" })).toBeChecked();
  await expect(other.getByRole("checkbox", { name: "地图作品名称" })).toBeChecked();
  await expect(other.locator("html")).toHaveAttribute("data-ae-position", "left");
  await page.reload();
  await installMap(page);
  await expect((await openMarkerMenu(page)).getByRole("checkbox", { name: "彩色圆点" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "作品头像" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "地图作品名称" })).toBeChecked();
  await expect.poll(visibility).toBe(null);
  await expect(page.locator("html")).toHaveAttribute("data-ae-position", "left");
});

test("圆点、头像和名称的八种组合独立生效，还原原图层且不改变作品栏", async () => {
  await installMap(page);
  const original = await page.evaluate(() => structuredClone(mapLayers));
  const works = await page.locator(".ae-name").allTextContents();
  for (const [dots, avatars, names] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
    await setMarkerVisible(page, "彩色圆点", !!dots);
    await setMarkerVisible(page, "作品头像", !!avatars);
    await setMarkerVisible(page, "地图作品名称", !!names);
    await expect.poll(() => page.evaluate(() => ({
      dots: mapLayers["bangumi-point"].layout.visibility !== "none",
      avatars: mapLayers.bangumis.layout["icon-image"] !== "",
      names: mapLayers.bangumis.layout["text-field"] !== "",
    }))).toEqual({ dots: !!dots, avatars: !!avatars, names: !!names });
    expect(await page.locator(".ae-name").allTextContents()).toEqual(works);
    expect(await page.evaluate(() => mapLayers.stations)).toEqual(original.stations);
  }
  expect(await page.evaluate(() => mapLayers)).toEqual(original);
  const changes = await page.evaluate(() => mapCalls.length);
  await page.evaluate(() => { emitMap("styledata"); emitMap("idle"); });
  expect(await page.evaluate(() => mapCalls.length)).toBe(changes);
});

test("头像与名称在延迟初始化、图层重建、原生样式变更和扩展重载后仍可恢复", async () => {
  await setMarkerVisible(page, "作品头像", false);
  await setMarkerVisible(page, "地图作品名称", false);
  await installMap(page);
  const layout = () => page.evaluate(() => mapLayers.bangumis?.layout);
  await expect.poll(layout).toEqual({ "icon-image": "", "text-field": "" });
  await page.evaluate(() => {
    mapApp.map.setLayoutProperty("bangumis", "text-field", ["get", "cn"]);
    delete mapLayers.bangumis;
    emitMap("styledata");
    mapLayers.bangumis = { id: "bangumis", type: "symbol", source: "bangumis", layout: { "icon-image": ["get", "image"], "text-field": ["get", "name"] } };
    emitMap("style.load");
  });
  await expect.poll(layout).toEqual({ "icon-image": "", "text-field": "" });
  const host = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, await extensionId(context));
  await expect.poll(() => host.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.getByRole("dialog", { name: "地图标记" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "作品头像" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "地图作品名称" })).not.toBeChecked();
  await setMarkerVisible(page, "作品头像", true);
  await expect.poll(layout).toEqual({ "icon-image": ["get", "image"], "text-field": "" });
  await page.evaluate(() => mapApp.map.setLayoutProperty("bangumis", "text-field", ["get", "cn"]));
  await setMarkerVisible(page, "地图作品名称", true);
  await expect.poll(layout).toEqual({ "icon-image": ["get", "image"], "text-field": ["get", "cn"] });
  await page.evaluate(() => { mapLayers.bangumis.layout = {}; emitMap("styledata"); });
  await setMarkerVisible(page, "作品头像", false);
  await setMarkerVisible(page, "作品头像", true);
  await expect.poll(layout).toEqual({});
});

test("展开菜单不直接改变标记，支持键盘与外部关闭，和作品设置互斥且适应窄屏", async () => {
  await installMap(page);
  const menu = await openMarkerMenu(page);
  await expect.poll(visibility).toBe(null);
  await expect(menu.getByRole("checkbox", { name: "彩色圆点" })).toBeFocused();
  await page.evaluate(() => {
    window.mapEvents = [];
    for (const type of ["wheel", "click", "keydown", "pointerdown"]) document.addEventListener(type, () => mapEvents.push(type));
  });
  await page.keyboard.press("Space");
  await expect.poll(visibility).toBe("none");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(menu.getByRole("checkbox", { name: "作品头像" })).not.toBeChecked();
  await menu.hover();
  await page.mouse.wheel(0, 100);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "地图标记", exact: true })).toBeFocused();
  expect(await page.evaluate(() => mapEvents)).toEqual([]);
  await openMarkerMenu(page);
  await page.getByRole("button", { name: "作品设置", exact: true }).click();
  await expect(menu).toBeHidden();
  await openMarkerMenu(page);
  await expect(page.getByRole("dialog", { name: "作品设置" })).toBeHidden();
  for (const [width, height] of [[1367, 902], [390, 844], [320, 320], [1367, 360]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => menu.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= 12 && rect.right <= innerWidth - 12 && rect.top >= 12 && rect.bottom <= innerHeight - 12 && node.scrollWidth <= node.clientWidth;
    })).toBe(true);
  }
  await page.mouse.click(600, 200);
  await expect(menu).toBeHidden();
  await expect.poll(visibility).toBe("none");
});

test("地点缩略图单独隐藏，左侧作品列表补位，恢复原布局且保留筛选与地图标记", async () => {
  await installMap(page);
  await setPreference(page, "position", "left");
  await page.locator(".ae-item").first().click();
  const gallery = page.locator(".window-points-box");
  const toolbar = page.locator(".window-bangumis-box");
  const top = () => toolbar.evaluate(node => node.getBoundingClientRect().top);
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
  const originalTop = await top();
  const original = await page.evaluate(() => structuredClone(mapLayers));
  await setMarkerVisible(page, "地点缩略图", false);
  await expect(gallery).toBeHidden();
  await expect.poll(top).toBeLessThan(originalTop - 30);
  expect(await page.evaluate(() => mapLayers)).toEqual(original);
  expect(await page.evaluate(() => [...mapApp.selectedBangumiIds])).toEqual([221127]);
  await page.keyboard.press("Escape");
  await expect(gallery).toBeHidden();
  await setMarkerVisible(page, "地点缩略图", true);
  await expect(gallery).toBeVisible();
  await expect.poll(top).toBe(originalTop);
});

test("缩略图隐藏覆盖后续生成节点，重载扩展后保留，刷新重置且不强制显示网站已隐藏内容", async () => {
  await setMarkerVisible(page, "地点缩略图", false);
  await page.evaluate(() => {
    const previous = document.querySelector(".window-points-box");
    const next = previous.cloneNode(true);
    previous.replaceWith(next);
  });
  const gallery = page.locator(".window-points-box");
  await expect(gallery).toBeHidden();
  const host = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, await extensionId(context));
  await expect.poll(() => host.evaluate(node => node.isConnected)).toBe(false);
  await expect(page.getByRole("checkbox", { name: "地点缩略图" })).not.toBeChecked();
  await expect(gallery).toBeHidden();
  await expect(page.locator("#ae-thumbnail-visibility")).toHaveCount(1);
  await gallery.evaluate(node => { node.hidden = true; });
  await setMarkerVisible(page, "地点缩略图", true);
  await expect(gallery).toBeHidden();
  await gallery.evaluate(node => { node.hidden = false; });
  await expect(gallery).toBeVisible();
  await setMarkerVisible(page, "地点缩略图", false);
  const other = await context.newPage();
  await other.goto("https://w.anitabi.cn/map");
  await expect(other.locator(".window-points-box")).toBeVisible();
  await page.reload();
  await expect(gallery).toBeVisible();
  await expect((await openMarkerMenu(page)).getByRole("checkbox", { name: "地点缩略图" })).toBeChecked();
});
