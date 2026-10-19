import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, openPageSettings, setPreference, projectRoot, setMarkerVisible, openMarkerMenu } from '../tests/browser.js';
import { useCurlTransport } from '../tests/http-transport.js';

const directory = path.join(projectRoot, 'artifacts');
await mkdir(directory, { recursive: true });
const context = await launchBrowser({ serviceWorkers: 'block', deviceScaleFactor: 2 });
const cleanup = process.env.ANITABI_HTTP_TRANSPORT === 'curl' ? await useCurlTransport(context) : async () => {};
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://www.anitabi.cn/map?c=141.5787%2C43.0553&z=9.8', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.mapApp?.loaded, null, { timeout: 60000 });
  const panel = await openPageSettings(page);
  assert.equal(await panel.locator('input[type="number"]').count(), 0);
  await setPreference(page, 'position', 'left');
  console.log('真实札幌地图：默认展示远景作品列表，开始验证手动开关。');
  const region = page.locator('[data-ae-region="true"]');
  await region.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-ae-region] .ae-name').length > 2);
  assert.equal(await page.evaluate(() => mapApp.map.getZoom()), 9.8);
  assert(await page.locator('.window-points-box').isHidden());
  const rows = await region.locator('.window-bangumi-item').evaluateAll((items) => items.map((item) => ({
    id: Number(item.dataset.aeWorkId), name: item.querySelector('.ae-name')?.textContent, count: Number(item.dataset.num),
  })));
  // Independently count the site's complete work records, not the queried map
  // tiles, to catch missing tiles, symbol collision and duplicate-ID mistakes.
  const expected = await page.evaluate((rows) => {
    const map = mapApp.map;
    const bounds = map.getBounds();
    const padding = map.getPadding();
    const degrees = (pixels) => pixels * .703 / 2 ** map.getZoom();
    bounds.extend([bounds.getWest() - degrees(padding.left), bounds.getNorth() + degrees(padding.top)]);
    bounds.extend([bounds.getEast() + degrees(padding.right), bounds.getSouth() - degrees(padding.bottom)]);
    return rows.map(({ id }) => ({ id, count: new Set(mapApp.BangumiIds[id].points
      .filter((point) => point.geo && bounds.contains([point.geo[1], point.geo[0]])).map((point) => point.id)).size }));
  }, rows);
  assert.deepEqual(rows.map(({ id, count }) => ({ id, count })), expected);
  const dismiss = page.getByText('知道了', { exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.waitForFunction(() => {
    const list = document.querySelector('[data-ae-region] .window-bangumi-list').getBoundingClientRect();
    return [...document.querySelectorAll('[data-ae-region] img')].filter((image) => {
      const bounds = image.getBoundingClientRect();
      return bounds.top < list.bottom && bounds.bottom > list.top;
    }).every((image) => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 20000 });
  await page.screenshot({ path: path.join(directory, 'map-sapporo-zoom-9.8.png') });
  await openPageSettings(page);
  await panel.screenshot({ path: path.join(directory, 'settings-work-list.png') });
  assert(await panel.locator('footer').evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight));
  await region.locator('.ae-item').first().click();
  const selected = await page.evaluate(() => [...mapApp.selectedBangumiIds]);
  assert.deepEqual(selected, [rows[0].id]);
  await page.evaluate(() => mapApp.map.jumpTo({ zoom: 12 }));
  await page.waitForFunction(() => {
    const native = document.querySelector('.window-bangumis-box:not([data-ae-region])');
    return !native.hidden && !native.hasAttribute('data-ae-replaced') && document.querySelector('[data-ae-region]').hidden;
  });
  assert.deepEqual(await page.evaluate(() => [...mapApp.selectedBangumiIds]), selected);
  await page.evaluate(() => mapApp.map.jumpTo({ zoom: 9.8 }));
  await region.waitFor({ state: 'visible' });
  await region.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => [...mapApp.selectedBangumiIds]), []);
  await region.locator('.ae-item').first().click();
  const activeSelection = await page.evaluate(() => [...mapApp.selectedBangumiIds]);
  await setMarkerVisible(page, '区域作品列表', false);
  await region.waitFor({ state: 'hidden' });
  const summary = page.getByRole('group', { name: '当前作品筛选' });
  await summary.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(directory, 'work-list-hidden-selection.png') });
  await page.screenshot({ path: path.join(directory, 'work-list-menu.png'), clip: { x: 1030, y: 305, width: 337, height: 470 } });
  for (const zoom of [12.1, 9.8]) {
    await page.evaluate(zoom => mapApp.map.jumpTo({ zoom }), zoom);
    await page.waitForFunction(() => !mapApp.map.isMoving());
    assert.equal(await page.locator('.window-bangumis-box:visible').count(), 0);
    assert.deepEqual(await page.evaluate(() => [...mapApp.selectedBangumiIds]), activeSelection);
  }
  await summary.getByRole('button', { name: /^已筛选/ }).click();
  await region.waitFor({ state: 'visible' });
  await setMarkerVisible(page, '区域作品列表', false);
  await summary.getByRole('button', { name: '清除筛选', exact: true }).click();
  await summary.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => [...mapApp.selectedBangumiIds]), []);
  assert.equal(await page.locator('.window-bangumis-box:visible').count(), 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await region.waitFor({ state: 'visible', timeout: 60000 });
  assert.equal(await (await openMarkerMenu(page)).getByRole('checkbox', { name: '区域作品列表' }).isChecked(), true);
  assert.deepEqual(errors, []);
  const report = { checkedAt: new Date().toISOString(), zoom: 9.8, manualToggle: true, rows, countsMatchFullData: true,
    selectionPreserved: true, clearWhileHidden: true, zoomCannotReopen: true, refreshRestoresVisibility: true, nativeHandoff: true, errors };
  await writeFile(path.join(directory, 'work-list-live-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await cleanup();
}
