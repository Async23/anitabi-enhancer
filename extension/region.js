(() => {
  if (!/\/map(?:\/|$)/.test(location.pathname) || globalThis.__aeWorkList) return;
  globalThis.__aeWorkList = true;
  const nativeSelector = '.window-bangumis-box:not([data-ae-region])';
  const nativeMinZoom = 12;
  let map;
  let timer;
  let toolbar;
  let list;
  let clear;
  let note;
  let entries = new Map();
  let updating = false;
  const style = document.createElement('style');
  style.id = 'ae-work-list-style';
  style.textContent = `
    html[data-ae-works-hidden="true"] .window-bangumis-box,
    .window-bangumis-box[data-ae-work-list-suppressed="true"],
    .window-bangumis-box[data-ae-region]:not([data-ae-work-list]) { display: none !important; }
    .window-bangumis-box .ae-list-note { flex: 0 0 auto; align-self: center; grid-column: 1 / -1; box-sizing: border-box; max-width: 260px; padding: 12px; margin: 3px; border: 1px solid var(--ae-border); border-radius: 8px; color: var(--ae-muted); background: var(--ae-bg); font: 12px/1.5 system-ui, sans-serif; white-space: normal; pointer-events: auto; }
    .window-bangumis-box .ae-list-note[hidden] { display: none !important; }
    .window-bangumis-box[data-ae-layout="left"] .ae-list-note { align-self: stretch; margin: 3px 0; }
  `;
  document.head.append(style);
  // Legacy pages may still have a threshold-controlled list and its listener.
  // Use a separate marker so their cleanup cannot hide the current list.
  document.querySelectorAll('[data-ae-region]:not([data-ae-work-list])').forEach(node => node.remove());

  function attribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function restoreNative() {
    document.querySelectorAll(nativeSelector).forEach((node) => node.removeAttribute('data-ae-work-list-suppressed'));
    if (toolbar && !toolbar.hidden) toolbar.hidden = true;
    if (note?.textContent) note.textContent = '';
  }

  function ensureToolbar(native) {
    if (toolbar?.isConnected) return;
    toolbar = document.createElement('div');
    toolbar.className = 'window-bangumis-box';
    toolbar.dataset.aeRegion = 'true';
    toolbar.dataset.aeWorkList = 'true';
    toolbar.hidden = true;
    list = document.createElement('div');
    list.className = 'window-bangumi-list';
    note = document.createElement('div');
    note.className = 'ae-list-note';
    note.setAttribute('role', 'status');
    list.append(note);
    clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ae-region-clear';
    clear.textContent = '清除筛选';
    clear.addEventListener('click', () => {
      clearSelection();
    });
    toolbar.append(list, clear);
    native.after(toolbar);
    entries = new Map();
  }

  function regionCounts(app) {
    if (!map.getSource('points')) throw new Error('Point source unavailable');
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const padding = map.getPadding();
    // Match the site's viewport padding, including the area behind its panels.
    const degrees = (pixels) => pixels * .703 / 2 ** zoom;
    bounds.extend([bounds.getWest() - degrees(padding.left), bounds.getNorth() + degrees(padding.top)]);
    bounds.extend([bounds.getEast() + degrees(padding.right), bounds.getSouth() - degrees(padding.bottom)]);
    const seen = new Set();
    const counts = new Map();
    // Query the source, not rendered symbols: collision hiding and work filters
    // must not remove other works from the regional list. Tiles can repeat IDs.
    for (const feature of map.querySourceFeatures('points')) {
      const { pid, aid } = feature.properties || {};
      const id = Number(aid);
      if (pid == null || !app.BangumiIds[id] || feature.geometry?.type !== 'Point') continue;
      if (!bounds.contains(feature.geometry.coordinates) || seen.has(String(pid))) continue;
      seen.add(String(pid));
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  function coverURL(work) {
    const source = work.icon || work.cover;
    if (!source) return '';
    const url = new URL(source, location.href);
    // These are the same image routes used by the site's current image loader.
    // /images/ on the map host returns HTML, not the image itself.
    if (url.origin === location.origin && url.pathname.startsWith('/images/')) {
      url.hostname = location.hostname === 'www.anitabi.cn' ? 'img-tc.anitabi.cn' : 'image-anitabi.magiconch.com';
      url.pathname = url.pathname.slice('/images'.length);
      if (!work.icon) url.searchParams.set('plan', 'h160');
    }
    if (url.hostname === 'lain.bgm.tv') {
      url.hostname = 'bgm-tc.anitabi.cn';
      url.pathname = '/img' + url.pathname;
    }
    if (url.hostname === 'bgm-api.anitabi.cn') url.hostname = 'bgm-tc.anitabi.cn';
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  }

  function createItem(id) {
    const item = document.createElement('div');
    item.className = 'window-bangumi-item';
    item.dataset.aeWorkId = String(id);
    const image = document.createElement('img');
    image.className = 'ui-image cover';
    image.loading = 'lazy';
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.dataset.loaded = 'false';
    image.addEventListener('load', () => { image.dataset.loaded = 'true'; });
    item.append(image);
    item.addEventListener('click', () => {
      const app = window.mapApp;
      const selected = new Set(app.selectedBangumiIds);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      app.setSelectedBangumis([...selected]);
      update();
    });
    return item;
  }

  function render(app, native, counts, selected, showCounts, message = '') {
    ensureToolbar(native);
    const allIds = [...new Set([...selected, ...counts.keys()])]
      .filter((id) => app.BangumiIds[id])
      .sort((a, b) => Number(selected.has(b)) - Number(selected.has(a))
        || (counts.get(b) || 0) - (counts.get(a) || 0) || a - b);
    const ids = allIds.slice(0, Math.max(20, selected.size));
    const keep = new Set(ids);
    for (const [id, node] of entries) {
      if (keep.has(id)) continue;
      node.remove();
      entries.delete(id);
    }
    ids.forEach((id, index) => {
      const work = app.BangumiIds[id];
      let item = entries.get(id);
      if (!item) {
        item = createItem(id);
        entries.set(id, item);
      }
      attribute(item, 'data-num', showCounts ? String(counts.get(id) || 0) : '');
      attribute(item, 'data-selected', String(selected.has(id)));
      item.style.setProperty('--bangumi-color', work.color || '#222');
      const image = item.querySelector('img');
      const source = coverURL(work);
      if (source) {
        if (image.src !== source) {
          image.dataset.loaded = 'false';
          image.src = source;
        }
      } else image.removeAttribute('src');
      if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
    });
    attribute(toolbar, 'data-has-selection', String(selected.size > 0));
    clear.hidden = selected.size === 0;
    const text = message || (allIds.length > ids.length ? `显示前 ${ids.length} 部，放大地图可查看更多` : '')
      || (!ids.length ? '当前区域暂无已加载作品，可移动或放大地图' : '');
    if (note.textContent !== text) note.textContent = text;
    note.hidden = !text;
    if (toolbar.hidden) toolbar.hidden = false;
    attribute(native, 'data-ae-work-list-suppressed', 'true');
  }

  function update() {
    if (updating) return;
    clearTimeout(timer);
    timer = undefined;
    updating = true;
    try { updateList(); } finally { updating = false; }
  }

  function updateList() {
    const app = window.mapApp;
    const native = document.querySelector(nativeSelector);
    const selected = new Set([...(app?.selectedBangumiIds || [])].map(Number));
    attribute(document.documentElement, 'data-ae-selection-count', String(selected.size));
    if (document.documentElement.dataset.aeWorksHidden === 'true') {
      if (toolbar && !toolbar.hidden) toolbar.hidden = true;
      return;
    }
    if (!native || app?.bangumiId) {
      restoreNative();
      return;
    }
    bindMap();
    if (!app?.loaded || !map?.getZoom || typeof app.setSelectedBangumis !== 'function') {
      // Keep an already usable native list while the application initializes.
      if (!native.hidden && native.getBoundingClientRect().height > 0) return;
      if (app?.BangumiIds) render(app, native, new Map(), selected, false, '正在加载当前区域作品…');
      return;
    }
    if (map.getZoom() >= nativeMinZoom) {
      native.removeAttribute('data-ae-work-list-suppressed');
      const hasItems = [...native.querySelectorAll('.window-bangumi-item')].some(item => !item.hidden);
      if (!native.hidden && native.getBoundingClientRect().height > 0 && hasItems) {
        restoreNative();
        return;
      }
    }
    if (map.isMoving?.()) {
      if (!toolbar || toolbar.hidden) render(app, native, new Map(), selected, false, '正在更新当前区域作品…');
      return;
    }
    if (!map.getSource?.('points') || map.isSourceLoaded?.('points') === false) {
      render(app, native, new Map(), selected, false, '正在加载当前区域作品…');
      return;
    }
    try {
      const counts = regionCounts(app);
      render(app, native, counts, selected, true);
    } catch {
      render(app, native, new Map(), selected, false, '暂时无法读取作品，移动地图后会重试');
    }
  }

  function clearSelection() {
    const app = window.mapApp;
    if (typeof app?.setSelectedBangumis === 'function') {
      app.setSelectedBangumis([]);
    } else if (app?.selectedBangumiIds) {
      // Retain native click behavior on pages whose selection method is not yet
      // available, including older site versions.
      document.querySelectorAll(`${nativeSelector} .window-bangumi-item[data-selected="true"]`).forEach(node => node.click());
    }
    update();
  }

  function visibilityChanged() {
    // Existing card enhancers observe root classes, so this also refreshes
    // their layout when reopening a list after resizing an older page.
    document.documentElement.classList.toggle('ae-work-list-hidden', document.documentElement.dataset.aeWorksHidden === 'true');
    update();
  }

  function schedule() {
    if (timer !== undefined) return;
    timer = setTimeout(update, 300);
  }

  function bindMap() {
    const next = window.mapApp?.map;
    if (!next?.on || next === map) return;
    for (const event of ['idle', 'moveend', 'load', 'sourcedata']) map?.off(event, schedule);
    map = next;
    for (const event of ['idle', 'moveend', 'load', 'sourcedata']) map.on(event, schedule);
  }

  new MutationObserver(visibilityChanged).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-ae-works-hidden'],
  });
  document.addEventListener('ae-work-list-clear', clearSelection);

  new MutationObserver((mutations) => {
    if (!mutations.some(({ target, addedNodes, removedNodes }) => {
      if (target === document.documentElement) return true;
      if (!(target instanceof Element) || target.closest('[data-ae-region]')) return false;
      if (target.closest(nativeSelector) || target.matches('.map-box')) return true;
      return [...addedNodes, ...removedNodes].some((node) => node instanceof Element
        && (node.matches(nativeSelector) || node.querySelector(nativeSelector)));
    })) return;
    bindMap();
    schedule();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-has-selection', 'data-selected', 'data-bangumi-id'],
  });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  bindMap();
  schedule();
})();
