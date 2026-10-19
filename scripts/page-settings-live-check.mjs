import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, extensionId, reloadExtension, projectRoot, openPageSettings, triggerAction, openMarkerMenu, setMarkerVisible, setPreference } from "../tests/browser.js";
import { useCurlTransport } from "../tests/http-transport.js";

const directory = path.join(projectRoot, "artifacts");
await mkdir(directory, { recursive: true });
const context = await launchBrowser({ serviceWorkers: "block", deviceScaleFactor: 2 });
const cleanup = process.env.ANITABI_HTTP_TRANSPORT === "curl" ? await useCurlTransport(context) : async () => {};
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://www.anitabi.cn/map?c=139.7028%2C35.6614&z=11.7", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => window.mapApp?.loaded, null, { timeout: 60000 });
  const dismiss = page.getByText("知道了", { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForFunction(() => mapApp.map.queryRenderedFeatures({ layers: ["bangumi-point"] }).length > 100
    && mapApp.map.queryRenderedFeatures({ layers: ["bangumis"] }).length > 0, null, { timeout: 30000 });
  const initial = await page.evaluate(() => ({
    center: mapApp.map.getCenter().toArray(), zoom: mapApp.map.getZoom(),
    dots: mapApp.map.queryRenderedFeatures({ layers: ["bangumi-point"] }).length,
    avatars: mapApp.map.queryRenderedFeatures({ layers: ["bangumis"] }).length,
    pointLayer: mapApp.map.getStyle().layers.find(layer => layer.id === "bangumi-point"),
    symbols: mapApp.map.getStyle().layers.find(layer => layer.id === "bangumis"),
  }));
  await page.screenshot({ path: path.join(directory, "map-dots-visible.png") });
  await setMarkerVisible(page, "彩色圆点", false);
  await page.waitForFunction(() => mapApp.map.getLayer("ae-points-source")
    && mapApp.map.getLayoutProperty("bangumi-point", "visibility") === "none"
    && mapApp.map.queryRenderedFeatures({ layers: ["bangumi-point"] }).length === 0);
  assert.deepEqual(await page.evaluate(() => mapApp.map.getStyle().layers.find(layer => layer.id === "bangumis")), initial.symbols);
  assert(await page.evaluate(() => mapApp.map.queryRenderedFeatures({ layers: ["bangumis"] }).length > 0));
  await page.mouse.move(600, 400);
  await page.screenshot({ path: path.join(directory, "map-dots-hidden.png") });
  await page.screenshot({ path: path.join(directory, "map-controls.png"), clip: { x: 1167, y: 562, width: 200, height: 340 } });
  const controlStyle = await page.evaluate(() => {
    const root = document.getElementById("ae-page-settings").shadowRoot;
    const native = document.querySelector(".mapboxgl-ctrl-group-random-to-bangumi");
    const rect = native.getBoundingClientRect();
    const style = getComputedStyle(native);
    return [...root.querySelectorAll(".map-control")].every(button => {
      const bounds = button.getBoundingClientRect();
      const own = getComputedStyle(button);
      return bounds.width === rect.width && bounds.height === rect.width && bounds.right === rect.right
        && own.borderRadius === style.borderRadius && own.boxShadow === style.boxShadow;
    });
  });
  assert(controlStyle, "新增按钮应与原生按钮同尺寸、圆角、边框并右对齐");
  await page.evaluate(() => mapApp.map.jumpTo({ center: [139.69, 35.68], zoom: 12.2 }));
  await page.waitForFunction(() => !mapApp.map.isMoving());
  assert.equal(await page.evaluate(() => mapApp.map.getLayoutProperty("bangumi-point", "visibility")), "none");
  const idBefore = await extensionId(context);
  const previousControls = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, idBefore);
  await page.waitForFunction(node => !node.isConnected, previousControls);
  assert.equal(await (await openMarkerMenu(page)).getByRole("checkbox", { name: "彩色圆点" }).isChecked(), false);
  await page.evaluate(({center,zoom}) => mapApp.map.jumpTo({center,zoom}), initial);
  await setMarkerVisible(page, "彩色圆点", true);
  await page.waitForFunction(() => mapApp.map.queryRenderedFeatures({ layers: ["bangumi-point"] }).length > 100);
  assert.deepEqual(await page.evaluate(() => mapApp.map.getStyle().layers.find(layer => layer.id === "bangumi-point")), initial.pointLayer);
  console.log(`彩色圆点 ${initial.dots} 个 → 0；作品头像与名称保留，拖动、缩放、重载扩展和一键恢复通过。`);

  const symbolChecks = [];
  // Icons and names share one native layer. Verify each combination using the
  // real renderer, including no remaining hit targets when both are hidden.
  await setMarkerVisible(page, "彩色圆点", false);
  for (const [avatars, names, screenshot] of [[false, true, "names-only"], [true, false, "avatars-only"], [false, false, "all-hidden"], [true, true, "symbols-restored"]]) {
    await setMarkerVisible(page, "作品头像", avatars);
    await setMarkerVisible(page, "地图作品名称", names);
    await page.waitForFunction(({ avatars, names }) => {
      const map = mapApp.map;
      const icon = map.getLayoutProperty("bangumis", "icon-image");
      const text = map.getLayoutProperty("bangumis", "text-field");
      const rendered = map.queryRenderedFeatures({ layers: ["bangumis"] }).length;
      return (icon !== "") === avatars && (text !== "") === names && (!!rendered === (avatars || names)) && map.loaded();
    }, { avatars, names }, { timeout: 30000 });
    const rendered = await page.evaluate(() => mapApp.map.queryRenderedFeatures({ layers: ["bangumis"] }).length);
    symbolChecks.push({ avatars, names, rendered });
    await page.mouse.move(600, 400);
    await page.screenshot({ path: path.join(directory, `map-markers-${screenshot}.png`) });
  }
  assert.deepEqual(await page.evaluate(() => mapApp.map.getStyle().layers.find(layer => layer.id === "bangumis")), initial.symbols);
  await page.screenshot({ path: path.join(directory, "map-markers-menu.png"), clip: { x: 1040, y: 410, width: 327, height: 360 } });
  await setMarkerVisible(page, "彩色圆点", true);
  console.log("真实地图：仅名称、仅头像、全部隐藏与完整恢复通过；全部隐藏后没有符号点击区域。");

  const launcher = page.getByRole("button", { name: "作品设置", exact: true });
  await launcher.click();
  const panel = page.getByRole("dialog", { name: "作品设置" });
  await panel.getByText("左侧列表", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ae-region="true"]')?.dataset.aeLayout === "left"
    && document.querySelectorAll("[data-ae-region] .ae-name").length > 2);
  const region = page.locator('[data-ae-region="true"]');
  await page.waitForFunction(() => {
    const list = document.querySelector("[data-ae-region] .window-bangumi-list").getBoundingClientRect();
    return [...document.querySelectorAll("[data-ae-region] img")].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.top < list.bottom && rect.bottom > list.top;
    }).every((image) => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 20000 });
  console.log("真实东京地图：页面内设置已生成远景作品列表，正在验证布局和同步。");
  const count = await region.locator(".ae-item").count();
  assert(count > 2);
  const geometry = async () => page.evaluate(() => {
    const root = document.getElementById("ae-page-settings").shadowRoot;
    const button = root.getElementById("controls").getBoundingClientRect();
    const panel = root.getElementById("panel");
    const bounds = panel.getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const controls = [...document.querySelectorAll(".mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-group, .side-search-form")];
    return {
      panelInside: bounds.left >= 12 && bounds.right <= innerWidth - 12 && bounds.top >= 12 && bounds.bottom <= innerHeight - 12,
      clearControls: controls.every((node) => !overlaps(button, node.getBoundingClientRect())),
      noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth,
    };
  });
  assert.deepEqual(await geometry(), { panelInside: true, clearControls: true, noHorizontalOverflow: true });
  await page.screenshot({ path: path.join(directory, "page-settings-light.png") });
  assert.equal(await panel.locator("#theme").count(), 0);
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await panel.evaluate(node => getComputedStyle(node).backgroundColor), "rgb(32, 42, 54)");
  await page.screenshot({ path: path.join(directory, "page-settings-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await panel.getByText("仅图标", { exact: true }).click();
  await panel.getByText("顶部横排", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-ae-region]").dataset.aeLayout === "top");
  assert.equal(await region.locator(".ae-name").first().isVisible(), false);
  const id = await extensionId(context);
  await panel.getByRole("button", { name: "收起" }).click();
  await triggerAction(context, page, id);
  await panel.waitFor({ state: "visible" });
  assert.equal(await panel.getByRole("radio", { name: "仅图标" }).isChecked(), true);
  assert.equal(await panel.getByRole("radio", { name: "顶部横排" }).isChecked(), true);
  assert.equal(await panel.locator('input[type="number"]').count(), 0);
  await panel.getByText("显示名称", { exact: true }).click();
  await panel.getByText("左侧列表", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-ae-region]").dataset.aeLayout === "left");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const rect = document.getElementById("ae-page-settings").shadowRoot.getElementById("panel").getBoundingClientRect();
    return rect.right <= innerWidth - 12 && rect.left >= 12;
  });
  assert.deepEqual(await geometry(), { panelInside: true, clearControls: true, noHorizontalOverflow: true });
  await page.screenshot({ path: path.join(directory, "page-settings-narrow.png") });
  await page.setViewportSize({ width: 1367, height: 902 });
  await panel.getByRole("button", { name: "收起" }).click();
  await setMarkerVisible(page, "彩色圆点", false);
  await page.evaluate(() => mapApp.map.jumpTo({ center: [141.356, 43.0605], zoom: 11.7 }));
  await page.waitForFunction(() => document.querySelector('[data-ae-region]')?.hidden === false
    && [...document.querySelectorAll('[data-ae-region] .ae-name')].some(node => node.textContent === "听我的电波吧"), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => mapApp.map.queryRenderedFeatures({ layers: ["bangumi-point", "ae-points-source"] }).length), 0);
  const hiddenRows = await region.locator(".ae-name").allTextContents();
  await page.screenshot({ path: path.join(directory, "map-hidden-sapporo-works.png") });
  await page.evaluate(() => mapApp.map.jumpTo({ center: [139.7028, 35.6614], zoom: 11.7 }));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-ae-region] .ae-name')].some(node => node.textContent === "白箱"));
  await setMarkerVisible(page, "彩色圆点", true);
  await page.waitForFunction(() => !mapApp.map.getLayer("ae-points-source"));
  await openPageSettings(page);
  const previous = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, id);
  await page.waitForFunction((node) => !node.isConnected, previous);
  await panel.getByText("顶部横排", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-ae-region]").dataset.aeLayout === "top");
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  assert.equal(await page.evaluate(() => mapApp.map.getZoom()), 11.7);
  assert.equal(await page.locator("#ae-page-settings").count(), 1);
  await setMarkerVisible(page, "区域作品列表", false);
  await region.waitFor({ state: "hidden" });
  await setMarkerVisible(page, "区域作品列表", true);
  await setPreference(page, "position", "left");
  await page.evaluate(() => mapApp.map.jumpTo({ center: [139.6071, 35.6954], zoom: 12.1 }));
  await page.waitForFunction(() => {
    const gallery = document.querySelector(".window-points-box");
    const list = document.querySelector(".window-bangumis-box:not([data-ae-region])");
    return gallery?.offsetHeight > 40 && list?.offsetHeight > 0
      && list.getBoundingClientRect().top >= gallery.getBoundingClientRect().bottom;
  }, null, { timeout: 30000 });
  const gallery = page.locator(".window-points-box");
  const nativeList = page.locator(".window-bangumis-box:not([data-ae-region])");
  const galleryTopBefore = await nativeList.evaluate(node => node.getBoundingClientRect().top);
  await setMarkerVisible(page, "地点缩略图", false);
  await gallery.waitFor({ state: "hidden" });
  await page.waitForFunction(top => document.querySelector(".window-bangumis-box:not([data-ae-region])").getBoundingClientRect().top < top - 30, galleryTopBefore);
  const galleryTopAfter = await nativeList.evaluate(node => node.getBoundingClientRect().top);
  await page.mouse.move(600, 400);
  await page.screenshot({ path: path.join(directory, "map-thumbnails-hidden.png") });
  await page.screenshot({ path: path.join(directory, "map-thumbnails-menu.png"), clip: { x: 1040, y: 375, width: 327, height: 400 } });
  const oldMenu = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, id);
  await page.waitForFunction(node => !node.isConnected, oldMenu);
  assert.equal(await (await openMarkerMenu(page)).getByRole("checkbox", { name: "地点缩略图" }).isChecked(), false);
  assert.equal(await gallery.isVisible(), false);
  await setMarkerVisible(page, "地点缩略图", true);
  await gallery.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const gallery = document.querySelector(".window-points-box").getBoundingClientRect();
    const list = document.querySelector(".window-bangumis-box:not([data-ae-region])").getBoundingClientRect();
    return list.top >= gallery.bottom;
  });
  await page.screenshot({ path: path.join(directory, "map-thumbnails-restored.png") });
  await page.evaluate(() => mapApp.map.jumpTo({ center: [139.7028, 35.6614], zoom: 11.7 }));
  await gallery.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  console.log(`地点缩略图独立隐藏与恢复、扩展重载通过；左侧列表顶部 ${galleryTopBefore} → ${galleryTopAfter}。`);
  assert.deepEqual(errors, []);
  const report = { checkedAt: new Date().toISOString(), url: page.url(), works: count, toolbarOpensSamePanel: true,
    systemTheme: true, themeButtonRemoved: true, symbolChecks, thumbnails: { hiddenAndRestored: true, sidebarBefore: galleryTopBefore, sidebarAfter: galleryTopAfter, reloadPreserved: true, nativeZoomRespected: true }, narrowViewport: true, extensionReloadReconnected: true, mapRefreshed: false, mapZoom: 11.7, dotsHidden: true, avatarsPreserved: true, nativeControlStyle: controlStyle, dotsRestored: true, regionalWorksWhileHidden: hiddenRows, errors };
  await writeFile(path.join(directory, "page-settings-live-check.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await cleanup();
}
