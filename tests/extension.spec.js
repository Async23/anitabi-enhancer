import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { launchBrowser, extensionId, reloadExtension, openPageSettings, setPreference, extensionWorker, triggerAction } from "./browser.js";

const html = await readFile(new URL("./site.html", import.meta.url), "utf8");
const url = "https://www.anitabi.cn/map?c=144.2728%2C44.0197&z=13.2";
let context;
let page;

test.beforeEach(async () => {
  context = await launchBrowser();
  await context.route("**/*", (route) => {
    if (!route.request().url().startsWith("https://")) return route.continue();
    if (route.request().resourceType() === "document") {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#b7c9d8"/></svg>',
    });
  });
  page = await context.newPage();
  await page.goto(url);
});

test.afterEach(async () => { await context?.close(); });

test("真实加载扩展，名称正确，原有多选与键盘操作有效", async () => {
  const works = page.locator(".ae-item");
  await expect(page.locator(".ae-name")).toHaveText(["黄金神威", "北海道辣妹贼拉可爱"]);
  await expect(page.locator(".ae-count")).toHaveText(["5", "2"]);
  await works.first().click();
  await works.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(works.first()).toHaveAttribute("aria-pressed", "true");
  await expect(works.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(works.nth(1)).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => originalClicks)).toEqual([221127, 406119, 406119]);
  expect(await page.evaluate(() => [...mapApp.selectedBangumiIds])).toEqual([221127]);
});

test("节点复用更新名称，未知图片不会残留上一部作品", async () => {
  const first = page.locator(".window-bangumi-item").first();
  await expect(first.locator(".ae-name")).toHaveText("黄金神威");
  await first.evaluate((item) => {
    item.querySelector("img").src = "https://image.anitabi.cn/icon/406119.jpg?v=2";
    item.style.setProperty("--bangumi-color", "#ea508e");
    item.dataset.num = "7";
  });
  await expect(first.locator(".ae-name")).toHaveText("北海道辣妹贼拉可爱");
  await expect(first.locator(".ae-count")).toHaveText("7");
  await first.evaluate((item) => { item.querySelector("img").src = "/unknown.jpg"; });
  await expect(first.locator(".ae-name")).toHaveCount(0);
  await expect(first).not.toHaveAttribute("title");
  await first.evaluate((item) => { item.hidden = true; });
  await expect(first).not.toBeVisible();
});

test("数据延迟到达后恢复名称，blob 仅在匹配唯一时显示", async () => {
  const first = page.locator(".window-bangumi-item").first();
  await expect(first.locator(".ae-name")).toHaveText("黄金神威");
  await page.evaluate(() => {
    const works = mapApp.BangumiIds;
    mapApp.BangumiIds = {};
    document.querySelector(".window-bangumi-item").dataset.num = "6";
    setTimeout(() => { mapApp.BangumiIds = works; }, 600);
  });
  await expect(first.locator(".ae-name")).toHaveCount(0);
  await expect(first.locator(".ae-name")).toHaveText("黄金神威");
  await first.evaluate((item) => {
    item.querySelector("img").src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/svg+xml" }));
  });
  await expect(first.locator(".ae-name")).toHaveText("黄金神威");
  await page.evaluate(() => {
    mapApp.BangumiIds[999] = { id: 999, cn: "另一部作品", color: "#cc7900" };
    document.querySelector(".window-bangumi-item").dataset.num = "9";
  });
  await expect(first.locator(".ae-name")).toHaveCount(0);
});

test("设置即时更新且刷新后保留，移除主题按钮并自动跟随系统", async () => {
  await setPreference(page, "language", "ja");
  await expect(page.locator(".ae-name").first()).toHaveText("ゴールデンカムイ");
  await setPreference(page, "display", "compact");
  await expect(page.locator(".ae-name").first()).not.toBeVisible();
  const panel = await openPageSettings(page);
  await expect(panel.locator("#theme")).toHaveCount(0);
  const worker = await extensionWorker(context);
  await worker.evaluate(() => chrome.storage.local.set({ theme: "dark" }));
  await page.emulateMedia({ colorScheme: "light" });
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(panel).toHaveCSS("background-color", "rgb(32, 42, 54)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-ae-display", "compact");
  await expect(page.locator(".ae-item").first()).toHaveAttribute("title", /^ゴールデンカムイ/);
  await openPageSettings(page);
  await expect(panel.locator('input[name="language"][value="ja"]')).toBeChecked();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("html")).toHaveAttribute("data-ae-theme", "system");
});

test("重新加载扩展后修改设置，已打开的地图无需刷新即可同步", async () => {
  const otherMap = await context.newPage();
  await otherMap.goto("https://w.anitabi.cn/map");
  const id = await extensionId(context);
  await setPreference(page, "position", "left");
  await expect(otherMap.locator("html")).toHaveAttribute("data-ae-position", "left");
  await page.locator(".ae-item").first().click();
  const old = await page.locator("#ae-page-settings").elementHandle();
  await reloadExtension(context, id);
  await expect.poll(() => old.evaluate(node => node.isConnected)).toBe(false);
  await setPreference(page, "display", "compact");
  await setPreference(page, "position", "top");
  await expect(page.locator(".window-bangumis-box")).toHaveAttribute("data-ae-layout", "top");
  await expect(otherMap.locator("html")).toHaveAttribute("data-ae-position", "top");
  await expect(otherMap.locator(".ae-name").first()).not.toBeVisible();
  await setPreference(page, "language", "ja");
  await expect(page.locator(".ae-item").first()).toHaveAttribute("title", /^ゴールデンカムイ/);
  for (let i = 0; i < 3; i++) {
    await triggerAction(context, page);
    await expect(page.getByRole("dialog", { name: "作品设置" })).toBeVisible();
  }
  await page.getByRole("button", { name: "收起" }).click();
  expect(await page.evaluate(() => originalClicks)).toEqual([221127]);
  await expect(page.locator(".ae-scroller")).toHaveCount(1);
  await expect(page.locator(".ae-item").first()).toHaveAttribute("aria-pressed", "true");
  await page.locator(".ae-item").first().focus();
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => originalClicks)).toEqual([221127, 221127]);
});

test("页面设置保存失败时提示，并恢复到已保存的选项", async () => {
  await setPreference(page, "position", "left");
  const panel = await openPageSettings(page);
  const worker = await extensionWorker(context);
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.anitabi.cn/*" });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      chrome.storage.local.set = async () => { throw new Error("Storage write failed"); };
    } });
  });
  await panel.getByText("顶部横排", { exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("保存失败，请重试。");
  await expect(panel.locator('input[name="position"][value="left"]')).toBeChecked();
  expect(await worker.evaluate(async () => (await chrome.storage.local.get("position")).position)).toBe("left");
});

test("作品多、名称长时横向滚动，不覆盖搜索框或公告", async () => {
  await page.evaluate(() => {
    for (let id = 1; id <= 20; id++) {
      mapApp.BangumiIds[id] = { id, cn: "用于核对换行和内边距的很长作品名称第" + id + "季", title: "Long name", color: "#2379aa", icon: "/images/icon/" + id + ".jpg" };
      addWork(id, id);
    }
  });
  await expect(page.locator(".ae-name")).toHaveCount(22);
  for (const width of [1367, 850, 800, 390]) {
    await page.setViewportSize({ width, height: 902 });
    await expect.poll(async () => page.evaluate(() => {
      const list = document.querySelector(".window-bangumi-list");
      const rect = list.getBoundingClientRect();
      const notice = document.querySelector(".func-change-logs-fixed");
      const noticeRect = notice.getBoundingClientRect();
      return {
        inViewport: rect.right <= innerWidth,
        clearNotice: !noticeRect.width || rect.right < noticeRect.left || rect.top >= noticeRect.bottom,
        scrollable: list.scrollWidth > list.clientWidth,
        labelInside: [...document.querySelectorAll(".ae-name")].every((name) => {
          const label = name.getBoundingClientRect();
          const parent = name.parentElement.getBoundingClientRect();
          return label.top >= parent.top + 3 && label.bottom <= parent.bottom - 3 && label.height <= 35;
        }),
      };
    })).toEqual({ inViewport: true, clearNotice: true, scrollable: true, labelInside: true });
  }
  await page.evaluate(() => { document.querySelector(".func-change-logs-fixed").hidden = true; });
  await expect.poll(() => page.locator(".window-bangumis-box").evaluate((node) => node.getBoundingClientRect().top)).toBe(54);
});

test("不在其他网站运行，作品栏重建后继续增强", async () => {
  await expect(page.locator(".ae-name")).toHaveCount(2);
  await page.evaluate(() => {
    const old = document.querySelector(".window-bangumis-box");
    const replacement = document.createElement("div");
    replacement.className = old.className;
    replacement.innerHTML = '<div class="window-bangumi-list"></div>';
    old.replaceWith(replacement);
    addWork(221127, 10);
  });
  await expect(page.locator(".ae-name")).toHaveText(["黄金神威"]);
  await expect(page.locator(".ae-count")).toHaveText(["10"]);
  await page.goto("https://example.org/map");
  await expect(page.locator(".ae-name")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-ae-display");
});

test("右侧作品被截断时有可见入口，点击后能完整看到最后一部", async () => {
  await page.evaluate(() => {
    document.querySelector(".func-change-logs-fixed").hidden = true;
    for (let id = 1; id <= 8; id++) {
      mapApp.BangumiIds[id] = { id, cn: "小樽地区名称比较长的测试作品第" + id + "季", color: "#2379aa", icon: "/images/icon/" + id + ".jpg" };
      addWork(id, id);
    }
  });
  await expect(page.locator(".ae-name")).toHaveCount(10);
  const list = page.locator(".window-bangumi-list");
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const next = page.getByRole("button", { name: "向右浏览作品", exact: true });
  const previous = page.getByRole("button", { name: "向左浏览作品", exact: true });
  for (const width of [1367, 310]) {
    await page.setViewportSize({ width, height: 902 });
    await expect(next).toBeVisible();
    await expect(next).toBeEnabled();
    await expect(previous).toBeDisabled();
    for (let attempt = 0; attempt < 10 && await next.isEnabled(); attempt++) {
      await next.click();
    }
    await expect.poll(() => page.locator(".window-bangumi-item").last().evaluate((item) => {
      const itemRect = item.getBoundingClientRect();
      const listRect = item.parentElement.getBoundingClientRect();
      return itemRect.left >= listRect.left && itemRect.right <= listRect.right;
    })).toBe(true);
    await expect(next).toBeDisabled();
    for (let attempt = 0; attempt < 10 && await previous.isEnabled(); attempt++) {
      await previous.click();
    }
    await expect(previous).toBeDisabled();
    await expect.poll(() => list.evaluate((node) => node.scrollLeft)).toBe(0);
  }
  await page.setViewportSize({ width: 1367, height: 902 });
  await page.evaluate(() => {
    [...document.querySelectorAll(".window-bangumi-item")].slice(2).forEach((item) => item.remove());
  });
  await expect(next).toBeHidden();
  await expect(previous).toBeHidden();
  expect(await page.evaluate(() => originalClicks)).toEqual([]);
});

async function showOverflowingWorks() {
  await page.evaluate(() => {
    document.querySelector(".func-change-logs-fixed").hidden = true;
    for (let id = 1; id <= 8; id++) {
      mapApp.BangumiIds[id] = { id, cn: "用于检查滚动交互的作品" + id, color: "#2379aa", icon: "/images/icon/" + id + ".jpg" };
      addWork(id, id);
    }
  });
  await expect(page.locator(".ae-name")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "向右浏览作品", exact: true })).toBeVisible();
}

test("滚动条在卡片下方留出独立空间，头像在两种模式下均为圆角方形", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await showOverflowingWorks();
  for (const mode of ["labels", "compact"]) {
    await setPreference(page, "display", mode);
    await expect.poll(() => page.locator(".window-bangumi-list").evaluate((list) => {
      const bottom = list.getBoundingClientRect().top + list.clientTop + list.clientHeight;
      const cardBottom = Math.max(...[...list.querySelectorAll('.window-bangumi-item:not([hidden])')].map((item) => item.getBoundingClientRect().bottom));
      return bottom - cardBottom;
    })).toBeGreaterThanOrEqual(18);
    expect(await page.locator(".window-bangumi-item .cover").evaluateAll((images) => images.every((image) => {
      const bounds = image.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(image).borderTopLeftRadius);
      return bounds.width === bounds.height && radius > 0 && radius < bounds.width / 2;
    }))).toBe(true);
  }
});

test("作品栏滚轮支持左右滑动，在边界也不会传给地图，修饰键和栏外事件保持原行为", async () => {
  await showOverflowingWorks();
  const list = page.locator(".window-bangumi-list");
  await page.evaluate(() => {
    window.outsideWheelEvents = [];
    document.addEventListener("wheel", (event) => outsideWheelEvents.push({ deltaY: event.deltaY, ctrlKey: event.ctrlKey }), { passive: true });
  });
  await list.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => list.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => list.evaluate((node) => node.scrollLeft)).toBe(0);
  await page.mouse.wheel(120, 0);
  await expect.poll(() => list.evaluate((node) => node.scrollLeft)).toBeGreaterThan(50);
  await page.mouse.wheel(0, 100000);
  await expect(page.getByRole("button", { name: "向右浏览作品", exact: true })).toBeDisabled();
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, -100000);
  await expect(page.getByRole("button", { name: "向左浏览作品", exact: true })).toBeDisabled();
  await page.mouse.wheel(0, -100);
  await list.evaluate((node) => node.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true })));
  expect(await page.evaluate(() => outsideWheelEvents)).toEqual([]);
  expect(await page.evaluate(() => originalClicks)).toEqual([]);
  await list.evaluate((node) => node.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, ctrlKey: true, bubbles: true, cancelable: true })));
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 90);
  await expect.poll(() => page.evaluate(() => outsideWheelEvents)).toEqual([{ deltaY: 1, ctrlKey: true }, { deltaY: 90, ctrlKey: false }]);
});

test("展示位置可即时切换到缩略图下方，保留筛选并在刷新后记住", async () => {
  await showOverflowingWorks();
  const first = page.locator(".ae-item").first();
  await first.click();
  await expect(page.locator("html")).toHaveAttribute("data-ae-position", "top");
  await setPreference(page, "position", "left");
  const toolbar = page.locator(".window-bangumis-box");
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
  expect(await toolbar.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const gallery = document.querySelector(".window-points-box").getBoundingClientRect();
    const [first, second] = [...node.querySelectorAll(".ae-item")].map((item) => item.getBoundingClientRect());
    return bounds.left === gallery.left && bounds.top >= gallery.bottom + 8
      && first.left === second.left && second.top > first.bottom;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "向右浏览作品", exact: true })).toBeHidden();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await setPreference(page, "position", "top");
  await expect(toolbar).toHaveAttribute("data-ae-layout", "top");
  await expect.poll(() => toolbar.evaluate((node) => node.getBoundingClientRect().left)).toBe(340);
  await expect(page.getByRole("button", { name: "向右浏览作品", exact: true })).toBeVisible();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => originalClicks)).toEqual([221127]);
  await setPreference(page, "position", "left");
  await page.reload();
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
});

test("左侧列表随缩略图高度调整，纵向滚轮可看到末项且不会传给地图", async () => {
  await page.setViewportSize({ width: 1367, height: 650 });
  await showOverflowingWorks();
  await setPreference(page, "position", "left");
  const toolbar = page.locator(".window-bangumis-box");
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
  await page.locator(".window-points-box").evaluate((node) => { node.style.height = "200px"; });
  await expect.poll(() => toolbar.evaluate((node) => node.getBoundingClientRect().top)).toBe(270);
  const list = page.locator(".window-bangumi-list");
  const edgeFade = () => list.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      top: Number.parseFloat(style.getPropertyValue("--ae-fade-top")) > 0,
      bottom: Number.parseFloat(style.getPropertyValue("--ae-fade-bottom")) > 0,
      masked: style.maskImage !== "none",
    };
  });
  await expect.poll(edgeFade).toEqual({ top: false, bottom: true, masked: true });
  expect(await list.evaluate((node) => node.getBoundingClientRect().bottom <= document.querySelector(".mapboxgl-ctrl-bottom-left").getBoundingClientRect().top - 8)).toBe(true);
  await page.evaluate(() => {
    window.outsideWheelEvents = 0;
    document.addEventListener("wheel", () => outsideWheelEvents++, { passive: true });
  });
  await list.hover();
  await page.mouse.wheel(0, 80);
  await expect.poll(edgeFade).toEqual({ top: true, bottom: true, masked: true });
  await page.mouse.wheel(0, 100000);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect.poll(edgeFade).toEqual({ top: true, bottom: false, masked: true });
  expect(await list.evaluate((node) => node.scrollLeft)).toBe(0);
  expect(await page.locator(".ae-item").last().evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const list = node.parentElement.getBoundingClientRect();
    return bounds.top >= list.top && bounds.bottom <= list.bottom;
  })).toBe(true);
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(0);
  await expect.poll(edgeFade).toEqual({ top: false, bottom: true, masked: true });
  expect(await page.evaluate(() => outsideWheelEvents)).toBe(0);
  await page.locator(".window-points-box").evaluate((node) => { node.hidden = true; });
  await expect.poll(() => toolbar.evaluate((node) => node.getBoundingClientRect().top)).toBe(56);
  await expect.poll(edgeFade).toEqual({ top: false, bottom: false, masked: false });
  await setPreference(page, "position", "top");
  await expect(toolbar).toHaveAttribute("data-ae-layout", "top");
  await expect(list).not.toHaveAttribute("data-ae-fade");
  await list.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => list.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
});

test("左侧模式适应窄窗口和紧凑图标，空间不足时恢复顶部布局", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await showOverflowingWorks();
  await page.locator(".func-change-logs-fixed").evaluate((node) => { node.hidden = false; });
  await setPreference(page, "position", "left");
  const toolbar = page.locator(".window-bangumis-box");
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
  await expect.poll(() => toolbar.evaluate((node) => node.getBoundingClientRect().top)).toBe(228);
  await setPreference(page, "display", "compact");
  await expect(page.locator(".ae-name").first()).toBeHidden();
  expect(await toolbar.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const images = [...node.querySelectorAll(".cover")].map((image) => image.getBoundingClientRect());
    return bounds.right <= innerWidth - 12 && images.every((image) => image.left >= bounds.left && image.right <= bounds.right);
  })).toBe(true);
  await page.setViewportSize({ width: 390, height: 360 });
  await expect(toolbar).toHaveAttribute("data-ae-layout", "top");
  await expect(page.locator("html")).toHaveAttribute("data-ae-position", "left");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toolbar).toHaveAttribute("data-ae-layout", "left");
});
