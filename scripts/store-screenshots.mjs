import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchBrowser, projectRoot, setPreference, setMarkerVisible, openPageSettings, openMarkerMenu } from "../tests/browser.js";
import { useCurlTransport } from "../tests/http-transport.js";

const output = path.join(projectRoot, "store", "screenshots");
await mkdir(output, { recursive: true });
const context = await launchBrowser({
  serviceWorkers: "block",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const cleanup = process.env.ANITABI_HTTP_TRANSPORT === "curl" ? await useCurlTransport(context) : async () => {};
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = "https://www.anitabi.cn/map?c=141.356%2C43.0605&z=13.2";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => window.mapApp?.loaded, null, { timeout: 60000 });
  const dismiss = page.getByText("知道了", { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.waitForFunction(() => mapApp.map.loaded() && document.querySelectorAll(".ae-item").length > 3, null, { timeout: 30000 });

  async function capture(name) {
    await page.waitForFunction(() => [...document.querySelectorAll(".ae-item img")].filter(image => {
      const rect = image.getBoundingClientRect();
      const viewport = image.closest(".window-bangumi-list")?.getBoundingClientRect();
      return viewport && rect.width > 0 && rect.height > 0
        && rect.left < Math.min(innerWidth, viewport.right) && rect.right > Math.max(0, viewport.left)
        && rect.top < Math.min(innerHeight, viewport.bottom) && rect.bottom > Math.max(0, viewport.top);
    }).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
    await page.mouse.move(600, 720);
    await page.screenshot({ path: path.join(output, name), animations: "disabled" });
  }

  await capture("01-work-names.png");
  await setPreference(page, "position", "left");
  await setMarkerVisible(page, "地点缩略图", false);
  await page.waitForFunction(() => [...document.querySelectorAll('.window-bangumis-box[data-ae-layout="left"]')]
    .some(node => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().top < 100));
  await openPageSettings(page);
  await capture("02-layout-settings.png");
  await setMarkerVisible(page, "彩色圆点", false);
  await page.waitForFunction(() => mapApp.map.getLayoutProperty("bangumi-point", "visibility") === "none");
  await openMarkerMenu(page);
  await capture("03-visibility-menu.png");
  assert.deepEqual(errors, []);
  await mkdir(path.join(projectRoot, "artifacts"), { recursive: true });
  await writeFile(path.join(projectRoot, "artifacts", "store-screenshots-check.json"), JSON.stringify({
    checkedAt: new Date().toISOString(), url, width: 1280, height: 800,
    files: ["01-work-names.png", "02-layout-settings.png", "03-visibility-menu.png"], errors,
  }, null, 2) + "\n");
  console.log("已从独立浏览器生成 3 张 1280×800 商店截图。");
} finally {
  await context.close();
  await cleanup();
}
