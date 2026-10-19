import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { launchBrowser, extensionId, reloadExtension, openPageSettings, setPreference, extensionWorker, setMarkerVisible, openMarkerMenu } from './browser.js';

const html = await readFile(new URL('./site.html', import.meta.url), 'utf8');
let context;
let page;
let panel;

async function installMap() {
  await page.evaluate(() => {
    const native = document.querySelector('.window-bangumis-box:not([data-ae-region])');
    const gallery = document.querySelector('.window-points-box');
    const listeners = new Map();
    const point = (pid, aid, lng = 144.3, lat = 44) => ({
      type: 'Feature', properties: { pid, aid }, geometry: { type: 'Point', coordinates: [lng, lat] },
    });
    window.testMap = {
      zoom: 9.8,
      queries: 0,
      sourceReady: true,
      sourceExists: true,
      sourceFails: false,
      features: [point('a', 221127), point('a', 221127), point('b', 221127), point('c', 406119), point('outside', 221127, 140, 40)],
      bounds: [144, 43.5, 145, 44.5],
    };
    const emit = (event) => listeners.get(event)?.forEach((callback) => callback());
    const renderNative = () => {
      native.hidden = Boolean(mapApp.bangumiId) || (testMap.zoom < 12 && !mapApp.selectedBangumiIds.size);
      native.dataset.hasSelection = String(mapApp.selectedBangumiIds.size > 0);
      native.querySelectorAll('.window-bangumi-item').forEach((item, index) => {
        const id = [221127, 406119][index];
        item.dataset.selected = String(mapApp.selectedBangumiIds.has(id));
        item.hidden = testMap.zoom < 12 && !mapApp.selectedBangumiIds.has(id);
      });
      gallery.hidden = Boolean(mapApp.bangumiId) || testMap.zoom < 12;
    };
    mapApp.loaded = true;
    mapApp.setSelectedBangumis = (ids) => {
      mapApp.selectedBangumiIds = new Set(ids);
      renderNative();
      emit('idle');
    };
    mapApp.map = {
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
      },
      off(event, callback) { listeners.get(event)?.delete(callback); },
      getZoom: () => testMap.zoom,
      getSource: () => testMap.sourceExists ? {} : null,
      isSourceLoaded: () => testMap.sourceReady,
      isMoving: () => false,
      getPadding: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
      getBounds() {
        const [west, south, east, north] = testMap.bounds;
        return {
          getWest: () => west, getEast: () => east, getNorth: () => north, getSouth: () => south,
          extend() {},
          contains: ([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north,
        };
      },
      querySourceFeatures() { testMap.queries++; if (testMap.sourceFails) throw new Error("Loading"); return testMap.features; },
    };
    window.moveMap = (zoom) => {
      testMap.zoom = zoom;
      renderNative();
      emit('moveend');
      emit('idle');
    };
    renderNative();
  });
}

test.beforeEach(async () => {
  context = await launchBrowser();
  await context.route('https://**/*', (route) => route.fulfill(route.request().resourceType() === 'document'
    ? { contentType: 'text/html', body: html }
    : { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>' }));
  page = await context.newPage();
  await page.goto('https://www.anitabi.cn/map?z=9.8');
  await installMap();
  panel = await openPageSettings(page);
});

test.afterEach(async () => { await context?.close(); });

test('默认开启，远景按范围去重统计，跨缩放级别不会关闭且缩略图仍遵循原站规则', async () => {
  const region = page.locator('[data-ae-work-list]');
  await expect(region.locator('.ae-name')).toHaveText(['黄金神威', '北海道辣妹贼拉可爱']);
  await expect(region.locator('.ae-count')).toHaveText(['2', '1']);
  await expect(page.locator('.window-points-box')).toBeHidden();
  for (const zoom of [9.7, 0, 11.9]) {
    await page.evaluate(zoom => moveMap(zoom), zoom);
    await expect(region).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-ae-works-hidden', 'false');
  }
  await page.evaluate(() => { testMap.bounds = [139, 39, 141, 41]; moveMap(9.8); });
  await expect(region.locator('.ae-count')).toHaveText(['1']);
  await page.evaluate(() => moveMap(12));
  await expect(region).toBeHidden();
  await expect(page.locator('.window-bangumis-box:not([data-ae-region])')).toBeVisible();
  await expect(page.locator('.window-points-box')).toBeVisible();
  await page.evaluate(() => moveMap(22));
  await expect(page.locator('.window-bangumis-box:not([data-ae-region])')).toBeVisible();
  await page.evaluate(() => moveMap(9.8));
  await expect(region).toBeVisible();
});

test('关闭后跨缩放仍隐藏且停止统计，重新开启更新当前区域', async () => {
  await expect(page.locator('[data-ae-work-list] .ae-item')).toHaveCount(2);
  await setMarkerVisible(page, '区域作品列表', false);
  const queries = await page.evaluate(() => testMap.queries);
  for (const zoom of [0, 12, 22, 9.8]) {
    await page.evaluate(zoom => moveMap(zoom), zoom);
    await expect(page.locator('.window-bangumis-box:visible')).toHaveCount(0);
  }
  await page.evaluate(() => { testMap.bounds = [139, 39, 141, 41]; moveMap(9.8); });
  expect(await page.evaluate(() => testMap.queries)).toBe(queries);
  await setMarkerVisible(page, '区域作品列表', true);
  await expect(page.locator('[data-ae-work-list] .ae-name')).toHaveText(['黄金神威']);
  await expect(page.locator('[data-ae-work-list] .ae-count')).toHaveText(['1']);
  expect(await page.evaluate(() => testMap.zoom)).toBe(9.8);
});

test('收起列表保留筛选，提示可重新打开或清除，键盘与跨12级筛选有效', async () => {
  await setPreference(page, 'position', 'left');
  const region = page.locator('[data-ae-work-list]');
  await region.locator('.ae-item').first().click();
  await region.locator('.ae-item').nth(1).focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => [...mapApp.selectedBangumiIds])).toEqual([221127, 406119]);
  await setMarkerVisible(page, '区域作品列表', false);
  const summary = page.getByRole('group', { name: '当前作品筛选' });
  await expect(summary.getByRole('button', { name: '已筛选 2 部作品', exact: true })).toBeVisible();
  await page.evaluate(() => moveMap(12));
  await expect(page.locator('.window-bangumis-box:visible')).toHaveCount(0);
  await summary.getByRole('button', { name: '已筛选 2 部作品', exact: true }).click();
  await expect(page.locator('.window-bangumis-box:not([data-ae-region]) .ae-item').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toBeHidden();
  await page.evaluate(() => moveMap(9.8));
  await expect(region).toBeVisible();
  await setMarkerVisible(page, '区域作品列表', false);
  await summary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...mapApp.selectedBangumiIds])).toEqual([]);
  await expect(summary).toBeHidden();
  await expect(page.locator('.window-bangumis-box:visible')).toHaveCount(0);
});

test('加载、空区域与读取失败保留明确状态，详情页返回后恢复开关选择', async () => {
  const region = page.locator('[data-ae-work-list]');
  await page.evaluate(() => { testMap.sourceReady = false; moveMap(9.8); });
  await expect(region.getByRole('status')).toHaveText('正在加载当前区域作品…');
  await expect(region).toBeVisible();
  await page.evaluate(() => { testMap.sourceReady = true; testMap.bounds = [0, 0, 1, 1]; moveMap(9.8); });
  await expect(region.getByRole('status')).toContainText('暂无已加载作品');
  await expect(region).toBeVisible();
  await page.evaluate(() => { testMap.sourceFails = true; moveMap(9.8); });
  await expect(region.getByRole('status')).toContainText('暂时无法读取作品');
  await page.evaluate(() => { testMap.sourceFails = false; testMap.bounds = [144, 43.5, 145, 44.5]; moveMap(9.8); });
  await expect(region.locator('.ae-item')).toHaveCount(2);
  await page.evaluate(() => { mapApp.bangumiId = 221127; moveMap(9.8); });
  await expect(region).toBeHidden();
  await page.evaluate(() => { mapApp.bangumiId = null; moveMap(9.8); });
  await expect(region).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-ae-works-hidden', 'false');
});

test('远景默认最多20部并提示数量，超过20部的已选作品保留完整取消入口', async () => {
  await page.evaluate(() => {
    testMap.features = Array.from({ length: 30 }, (_, i) => {
      const id = 1000 + i;
      mapApp.BangumiIds[id] = { id, cn: `作品 ${i}`, title: `作品 ${i}`, color: '#3478c2', icon: `/images/icon/${id}.jpg` };
      return { properties: { pid: `p${i}`, aid: id }, geometry: { type: 'Point', coordinates: [144.3, 44] } };
    });
    moveMap(9.8);
  });
  const region = page.locator('[data-ae-work-list]');
  await expect(region.locator('.ae-item')).toHaveCount(20);
  await expect(region.getByRole('status')).toContainText('显示前 20 部');
  await page.evaluate(() => mapApp.setSelectedBangumis(Array.from({ length: 25 }, (_, i) => i + 1000)));
  await expect(region.locator('.ae-item')).toHaveCount(25);
  await expect(region.locator('.ae-item[aria-pressed="true"]')).toHaveCount(25);
  await setMarkerVisible(page, '区域作品列表', false);
  await expect(page.getByRole('button', { name: '已筛选 25 部作品', exact: true })).toBeVisible();
  await page.getByRole('group', { name: '当前作品筛选' }).getByRole('button', { name: '清除筛选' }).click();
  await expect.poll(() => page.evaluate(() => mapApp.selectedBangumiIds.size)).toBe(0);
});

test('扩展重载保留开关与展示偏好，刷新恢复开启，旧阈值不再生效', async () => {
  await setPreference(page, 'position', 'left');
  await setMarkerVisible(page, '区域作品列表', false);
  await (await extensionWorker(context)).evaluate(() => chrome.storage.local.set({ minZoom: 22 }));
  const previous = await page.locator('#ae-page-settings').elementHandle();
  await reloadExtension(context, await extensionId(context));
  await expect.poll(() => previous.evaluate(node => node.isConnected)).toBe(false);
  await expect((await openMarkerMenu(page)).getByRole('checkbox', { name: '区域作品列表' })).not.toBeChecked();
  await expect(page.locator('.window-bangumis-box:visible')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-ae-min-zoom');
  expect(await (await extensionWorker(context)).evaluate(() => chrome.storage.local.get('minZoom'))).toEqual({});
  await setMarkerVisible(page, '区域作品列表', true);
  await expect(page.locator('[data-ae-work-list]')).toHaveAttribute('data-ae-layout', 'left');
  await setMarkerVisible(page, '区域作品列表', false);
  await page.reload();
  await installMap();
  await expect(page.locator('[data-ae-work-list]')).toBeVisible();
  await expect(page.locator('[data-ae-work-list]')).toHaveCount(1);
  await expect(page.locator('#ae-work-list-style')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-ae-position', 'left');
});

test('远景封面代理、语言与紧凑显示继续有效', async () => {
  await page.evaluate(() => {
    mapApp.BangumiIds[221127].icon = null;
    mapApp.BangumiIds[221127].cover = '/images/bangumi/221127.jpg';
    mapApp.BangumiIds[406119].icon = null;
    mapApp.BangumiIds[406119].cover = 'http://bgm-api.anitabi.cn/pic/cover/l/example.jpg';
    moveMap(9.8);
  });
  const region = page.locator('[data-ae-work-list]');
  await expect(region.locator('img').nth(0)).toHaveAttribute('src', 'https://img-tc.anitabi.cn/bangumi/221127.jpg?plan=h160');
  await expect(region.locator('img').nth(1)).toHaveAttribute('src', 'https://bgm-tc.anitabi.cn/pic/cover/l/example.jpg');
  await setPreference(page, 'language', 'ja');
  await expect(region.locator('.ae-name').first()).toHaveText('ゴールデンカムイ');
  await setPreference(page, 'display', 'compact');
  await expect(region.locator('.ae-name').first()).toBeHidden();
});
