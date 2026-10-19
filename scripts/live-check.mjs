import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { launchBrowser, projectRoot, extensionId, openPageSettings, setPreference } from "../tests/browser.js";
import { useCurlTransport } from "../tests/http-transport.js";

const directory = path.join(projectRoot, "artifacts");
await mkdir(directory, { recursive: true });
const context = await launchBrowser({ serviceWorkers: "block", ignoreDefaultArgs: ["--hide-scrollbars"] });
const errors = [];
const transport = process.env.ANITABI_HTTP_TRANSPORT === "curl" ? "curl" : "browser";
const cleanup = transport === "curl" ? await useCurlTransport(context) : async () => {};
let page;
try {
  const id = await extensionId(context);
  console.log(`扩展已加载，正在打开真实地图（HTTP 通道：${transport}）。`);
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://www.anitabi.cn/map?c=144.2728%2C44.0197&z=13.2", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll(".ae-item").length >= 2, null, { timeout: 45000 });
  const original = await page.locator(".ae-name").allTextContents();
  assert(original.includes("黄金神威"));
  assert(original.includes("北海道辣妹贼拉可爱"));
  await page.waitForFunction(() => [...document.querySelectorAll('.window-bangumi-item:not([hidden]) img')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
  console.log("已确认网走区域的两个作品名称。正在验证筛选和地图区域切换。");
  await page.screenshot({ path: path.join(directory, "map-desktop.png"), animations: "disabled" });
  await page.locator(".ae-item").first().click();
  await page.waitForFunction(() => document.querySelector('.ae-item[aria-pressed="true"]'));
  await page.screenshot({ path: path.join(directory, "map-filtered.png"), animations: "disabled" });
  await page.locator('.ae-item[aria-pressed="true"]').first().click();
  await page.evaluate(() => window.mapApp.map.jumpTo({ center: [135.768, 35.01], zoom: 14 }));
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll(".ae-name")].map((item) => item.textContent);
    return names.length > 2 && !names.includes("黄金神威");
  }, null, { timeout: 30000 });
  const moved = await page.locator(".ae-name").allTextContents();
  await page.waitForFunction(() => [...document.querySelectorAll('.window-bangumi-item:not([hidden]) img')].slice(0, 3).every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
  await page.screenshot({ path: path.join(directory, "map-kyoto.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const toolbar = document.querySelector(".window-bangumi-list").getBoundingClientRect();
    const notice = document.querySelector(".func-change-logs-fixed").getBoundingClientRect();
    return toolbar.right <= innerWidth && (toolbar.right < notice.left || toolbar.top > notice.bottom);
  });
  await page.screenshot({ path: path.join(directory, "map-narrow.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1367, height: 902 });
  await page.evaluate(() => window.mapApp.map.jumpTo({ center: [141.0188, 43.1925], zoom: 13.4 }));
  await page.waitForFunction(() => [...document.querySelectorAll(".ae-name")].some((item) => item.textContent === "重启咲良田"), null, { timeout: 30000 });
  const dismiss = page.getByText("知道了", { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  const next = page.getByRole("button", { name: "向右浏览作品", exact: true });
  const previous = page.getByRole("button", { name: "向左浏览作品", exact: true });
  await next.waitFor({ state: "visible" });
  const waitForVisibleCovers = () => page.waitForFunction(() => {
    const list = document.querySelector(".window-bangumi-list").getBoundingClientRect();
    return [...document.querySelectorAll('.window-bangumi-item:not([hidden]) img')].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return bounds.right > list.left && bounds.left < list.right && bounds.bottom > list.top && bounds.top < list.bottom;
    }).every((image) => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 20000 });
  await waitForVisibleCovers();
  const otaru = await page.locator(".window-bangumi-item:not([hidden])").count();
  const selectedImages = () => page.locator('.window-bangumi-item[data-selected="true"] img').evaluateAll((images) => images.map((image) => image.src));
  const selectedBefore = await selectedImages();
  await page.screenshot({ path: path.join(directory, "map-otaru-start.png"), animations: "disabled" });
  const list = page.locator(".window-bangumi-list");
  const zoomBefore = await page.evaluate(() => window.mapApp.map.getZoom());
  await list.hover();
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => document.querySelector(".window-bangumi-list").scrollLeft > 0);
  const scrollbarGap = await list.evaluate((node) => {
    const bottom = node.getBoundingClientRect().top + node.clientTop + node.clientHeight;
    return bottom - Math.max(...[...node.querySelectorAll('.window-bangumi-item:not([hidden])')].map((item) => item.getBoundingClientRect().bottom));
  });
  assert(scrollbarGap >= 18, "滚动条应与卡片分开");
  assert(await page.locator(".window-bangumi-item:not([hidden]) .cover").evaluateAll((images) => images.every((image) => {
    const bounds = image.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(image).borderTopLeftRadius);
    return bounds.width === bounds.height && radius > 0 && radius < bounds.width / 2;
  })), "头像应为圆角方形");
  await page.locator(".window-bangumis-box").screenshot({ path: path.join(directory, "works-wheel.png"), animations: "disabled" });
  for (let attempt = 0; attempt < otaru && await next.isEnabled(); attempt++) await next.click();
  assert(await next.isDisabled(), "作品栏应能滚到最右侧");
  assert(await page.locator(".window-bangumi-item:not([hidden])").last().evaluate((item) => {
    const bounds = item.getBoundingClientRect();
    const list = item.parentElement.getBoundingClientRect();
    return bounds.left >= list.left - 1 && bounds.right <= list.right + 1;
  }), "最后一部作品应完整显示");
  await waitForVisibleCovers();
  await page.screenshot({ path: path.join(directory, "map-otaru-end.png"), animations: "disabled" });
  await list.hover();
  await page.mouse.wheel(0, 180);
  for (let attempt = 0; attempt < otaru && await previous.isEnabled(); attempt++) await previous.click();
  assert(await previous.isDisabled(), "作品栏应能回到开头");
  assert.equal(await page.evaluate(() => window.mapApp.map.getZoom()), zoomBefore, "作品栏滚轮不应缩放地图");
  assert.deepEqual(await selectedImages(), selectedBefore, "浏览作品栏不应改变筛选");
  console.log(`已验证小樽区域的 ${otaru} 项作品可向右浏览至末尾、返回开头，且筛选保持不变。`);
  await page.evaluate(() => window.mapApp.map.jumpTo({ center: [141.356, 43.0605], zoom: 15.6 }));
  await page.waitForFunction(() => [...document.querySelectorAll(".ae-name")].some((item) => item.textContent.includes("女神异闻录5")), null, { timeout: 30000 });
  await setPreference(page, "position", "left");
  await page.waitForFunction(() => document.querySelector('.window-bangumis-box[data-ae-layout="left"]'));
  assert(await list.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const gallery = document.querySelector(".window-points-box").getBoundingClientRect();
    const controls = document.querySelector(".mapboxgl-ctrl-bottom-left").getBoundingClientRect();
    return bounds.left < 30 && bounds.top >= gallery.bottom + 8 && bounds.bottom <= controls.top - 8;
  }), "左侧作品应位于缩略图下方、底部地图控件上方");
  await waitForVisibleCovers();
  await page.screenshot({ path: path.join(directory, "map-sapporo-left.png"), animations: "disabled" });
  await page.locator(".window-bangumis-box").screenshot({ path: path.join(directory, "works-left.png"), animations: "disabled" });
  const sidebarWorks = await page.locator(".window-bangumi-item:not([hidden])").count();
  const sidebarZoom = await page.evaluate(() => window.mapApp.map.getZoom());
  await list.hover();
  await page.mouse.wheel(0, 130);
  await page.waitForFunction(() => {
    const style = getComputedStyle(document.querySelector(".window-bangumi-list"));
    return Number.parseFloat(style.getPropertyValue("--ae-fade-top")) > 0
      && Number.parseFloat(style.getPropertyValue("--ae-fade-bottom")) > 0 && style.maskImage !== "none";
  });
  await waitForVisibleCovers();
  await page.locator(".window-bangumis-box").screenshot({ path: path.join(directory, "works-left-fade.png"), animations: "disabled" });
  await page.screenshot({ path: path.join(directory, "map-sapporo-left-fade.png"), animations: "disabled" });
  await page.mouse.wheel(0, 100000);
  await page.waitForFunction(() => {
    const list = document.querySelector(".window-bangumi-list");
    return list.scrollHeight - list.clientHeight - list.scrollTop <= 1;
  });
  assert(await page.locator(".window-bangumi-item:not([hidden])").last().evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const list = node.parentElement.getBoundingClientRect();
    return bounds.top >= list.top && bounds.bottom <= list.bottom;
  }), "左侧列表应能完整看到末项");
  assert.equal(await list.evaluate((node) => Number.parseFloat(getComputedStyle(node).getPropertyValue("--ae-fade-bottom"))), 0, "到底部后末项应完整显示，不再渐隐");
  await waitForVisibleCovers();
  await page.locator(".window-bangumis-box").screenshot({ path: path.join(directory, "works-left-end.png"), animations: "disabled" });
  assert.equal(await page.evaluate(() => window.mapApp.map.getZoom()), sidebarZoom, "左侧列表滚轮不应缩放地图");
  await setPreference(page, "position", "top");
  await page.waitForFunction(() => document.querySelector('.window-bangumis-box[data-ae-layout="top"]'));
  await setPreference(page, "position", "left");
  await page.waitForFunction(() => document.querySelector('.window-bangumis-box[data-ae-layout="left"]'));
  const panel = await openPageSettings(page);
  await panel.screenshot({ path: path.join(directory, "settings-sapporo.png"), animations: "disabled" });
  console.log(`已验证札幌区域 ${sidebarWorks} 项作品的左侧布局、上下滚动和位置切换。`);
  const report = { original, moved, otaru, sidebarWorks, positionPassed: true, edgeFadePassed: true, navigationPassed: true, wheelPassed: true, scrollbarGap, roundedSquareCovers: true, errors, transport, checkedAt: new Date().toISOString() };
  await writeFile(path.join(directory, "live-check.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(directory, "live-failure.png"), timeout: 5000 }).catch(() => {});
    await writeFile(path.join(directory, "live-failure.json"), JSON.stringify({
      error: error.message,
      title: await page.title().catch(() => ""),
      text: (await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")).slice(0, 2000),
      errors,
    }, null, 2));
  }
  throw error;
} finally {
  await context.close();
  await cleanup();
}
