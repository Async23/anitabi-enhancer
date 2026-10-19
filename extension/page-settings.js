(() => {
  if (!/\/map(?:\/|$)/.test(location.pathname) || !document.body) return;
  if (globalThis.__aePageSettingsAlive?.()) return;

  const previous = document.getElementById("ae-page-settings");
  const wasOpen = previous?.dataset.open === "true";
  const menuWasOpen = previous?.dataset.menuOpen === "true";
  previous?.dispatchEvent(new Event("ae-settings-dispose"));
  previous?.remove();
  const host = document.createElement("div");
  host.id = "ae-page-settings";
  // This rule also reaches existing tabs after an extension update. Keeping it
  // outside the shadow root lets it hide the native gallery without changing
  // the site's own styles or forcing an unavailable gallery to appear.
  const thumbnailStyle = document.createElement("style");
  thumbnailStyle.id = "ae-thumbnail-visibility";
  thumbnailStyle.textContent = 'html[data-ae-thumbnails-hidden="true"] .window-points-box { display: none !important; }';
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 12px; bottom: 210px; z-index: 1000; color-scheme: light; --accent: #1f6cb5; }
      @media (prefers-color-scheme: dark) { :host { color-scheme: dark; --accent: #94caff; } }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, input { font: inherit; }
      button { cursor: pointer; color: inherit; }
      button:focus-visible, input:focus-visible, input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 3px; }
      #controls { display: grid; gap: var(--control-gap, 9px); }
      .map-control { display: grid; place-items: center; width: var(--control-size, 29px); height: var(--control-size, 29px); margin: 0; padding: 0; border: 0; border-radius: 4px; color: #333; background: #fff; box-shadow: 0 0 0 2px rgba(0, 0, 0, .1); }
      .map-control:hover { background: #f2f2f2; }
      .map-control[aria-expanded="true"], .map-control[data-filtered="true"] { color: #1f6cb5; background: #edf3f8; }
      #markers:not([data-all-hidden="true"]) .slash { display: none; }
      .popover { position: fixed; color: var(--ae-text, #202b37); background: var(--ae-bg, #fff); border: 1px solid var(--ae-border, #dbe1e7); font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-height: calc(100dvh - 24px); border-radius: 14px; box-shadow: 0 8px 32px #12243a30; overflow: auto; overscroll-behavior: contain; }
      #panel { width: min(300px, calc(100vw - 24px)); padding: 16px; }
      #marker-menu { width: min(200px, calc(100vw - 24px)); padding: 12px; }
      #marker-menu h2 { margin: 0 4px 6px; font-size: 14px; }
      .marker-choice { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; padding: 6px 4px; border-radius: 6px; cursor: pointer; }
      .marker-choice:hover { background: var(--ae-count-bg, #edf1f5); }
      .marker-choice input { appearance: none; position: relative; flex: 0 0 auto; width: 28px; height: 16px; margin: 0; border: 1px solid var(--ae-border, #dbe1e7); border-radius: 9px; background: var(--ae-count-bg, #edf1f5); cursor: pointer; }
      .marker-choice input::after { content: ""; position: absolute; width: 10px; height: 10px; top: 2px; left: 2px; border-radius: 50%; background: var(--ae-muted, #576574); }
      .marker-choice input:checked { background: #1f6cb5; border-color: #1f6cb5; }
      .marker-choice input:checked::after { left: 14px; background: #fff; }
      #marker-menu .hint { margin: 8px 4px 0; padding-top: 8px; border-top: 1px solid var(--ae-border, #dbe1e7); }
      #filter-summary { position: fixed; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 24px); padding: 7px 10px; border-radius: 8px; border: 1px solid var(--ae-border, #dbe1e7); background: var(--ae-bg, #fff); color: var(--ae-text, #202b37); box-shadow: 0 2px 6px #12243a12; font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #filter-summary button { border: 0; padding: 0; background: transparent; color: var(--accent); }
      #showWorks { min-width: 0; text-align: left; }
      #clearFilter { flex: 0 0 auto; }
      #migration-note { margin-top: 7px; }
      header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
      h2 { margin: 0; font-size: 16px; line-height: 1.5; font-weight: 650; }
      .subtitle { margin: 2px 0 0; color: var(--ae-muted, #576574); font-size: 11px; }
      fieldset { margin: 0 0 13px; padding: 0; min-width: 0; border: 0; }
      legend { display: block; margin: 0 0 6px; padding: 0; font-size: 12px; font-weight: 600; }
      .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px; border-radius: 8px; background: var(--ae-count-bg, #edf1f5); }
      .choices label { min-width: 0; cursor: pointer; }
      .choices input { position: absolute; width: 1px; height: 1px; opacity: 0; }
      .choices span { display: block; padding: 6px 4px; border: 1px solid transparent; border-radius: 6px; text-align: center; white-space: nowrap; }
      .choices input:checked + span { background: var(--ae-bg, #fff); color: var(--accent); border-color: var(--ae-border, #dbe1e7); box-shadow: 0 1px 3px #12243a0f; }
      .choices label:hover span { color: var(--accent); }
      .hint { margin: 6px 0 0; color: var(--ae-muted, #576574); font-size: 11px; line-height: 1.6; }
      footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-top: 13px; padding-top: 10px; border-top: 1px solid var(--ae-border, #dbe1e7); }
      #status { flex: 1; margin: 0; min-height: 24px; padding-top: 3px; color: var(--ae-muted, #576574); font-size: 11px; }
      #close { padding: 2px 0 2px 6px; border: 0; background: transparent; color: var(--accent); white-space: nowrap; }
    </style>
    <div id="controls">
    <button id="markers" class="map-control" type="button" aria-label="地图标记" aria-haspopup="dialog" aria-expanded="false" aria-controls="marker-menu" title="地图标记">
      <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="m3 3 18 18" stroke="#edf3f8" stroke-width="5"/><path class="slash" d="m3 3 18 18"/>
      </svg>
    </button>
    <button id="launcher" class="map-control" type="button" aria-label="作品设置" aria-haspopup="dialog" aria-expanded="false" aria-controls="panel" title="作品设置">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true">
        <path d="M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>
      </svg>
    </button>
    </div>
    <section id="marker-menu" class="popover" role="dialog" aria-labelledby="marker-heading" hidden>
      <h2 id="marker-heading">地图标记</h2>
      <label class="marker-choice"><span>彩色圆点</span><input type="checkbox" name="dots" checked></label>
      <label class="marker-choice"><span>作品头像</span><input type="checkbox" name="avatars" checked></label>
      <label class="marker-choice"><span>地图作品名称</span><input type="checkbox" name="names" checked></label>
      <label class="marker-choice"><span>地点缩略图</span><input type="checkbox" name="thumbnails" checked></label>
      <label class="marker-choice"><span>区域作品列表</span><input type="checkbox" name="works" checked></label>
      <p class="hint">仅当前页面，刷新后恢复</p>
      <p id="migration-note" class="hint" hidden>作品列表改由此处开关，原缩放阈值已取消。</p>
    </section>
    <div id="filter-summary" role="group" aria-label="当前作品筛选" hidden><button id="showWorks" type="button"></button><button id="clearFilter" type="button">清除筛选</button></div>
    <section id="panel" class="popover" role="dialog" aria-labelledby="heading" hidden>
      <header>
        <div><h2 id="heading">作品设置</h2><p class="subtitle">调整作品栏，地图保持当前位置</p></div>
      </header>
      <fieldset><legend>列表中的作品名称</legend><div class="choices">
        <label><input type="radio" name="display" value="labels"><span>显示名称</span></label>
        <label><input type="radio" name="display" value="compact"><span>仅图标</span></label>
      </div></fieldset>
      <fieldset><legend>展示位置</legend><div class="choices">
        <label><input type="radio" name="position" value="top"><span>顶部横排</span></label>
        <label><input type="radio" name="position" value="left"><span>左侧列表</span></label>
      </div></fieldset>
      <fieldset><legend>名称语言</legend><div class="choices">
        <label><input type="radio" name="language" value="zh"><span>中文优先</span></label>
        <label><input type="radio" name="language" value="ja"><span>原名优先</span></label>
      </div></fieldset>
      <footer><p id="status" role="status">自动保存，立即生效</p><button id="close" type="button">收起</button></footer>
    </section>`;

  const launcher = shadow.getElementById("launcher");
  const markers = shadow.getElementById("markers");
  const menu = shadow.getElementById("marker-menu");
  const markerAttributes = { dots: "aeDotsHidden", avatars: "aeAvatarsHidden", names: "aeNamesHidden", thumbnails: "aeThumbnailsHidden", works: "aeWorksHidden" };
  const controlsBox = shadow.getElementById("controls");
  const panel = shadow.getElementById("panel");
  const filterSummary = shadow.getElementById("filter-summary");
  const showWorks = shadow.getElementById("showWorks");
  const status = shadow.getElementById("status");
  const events = new AbortController();
  const controlSelector = ".mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-group, .maplibregl-ctrl-bottom-right .maplibregl-ctrl-group";
  const observed = new Set();
  let frame = 0;
  let revision = 0;

  function render() {
    const data = document.documentElement.dataset;
    for (const key of ["display", "position", "language"]) {
      const value = data[`ae${key[0].toUpperCase()}${key.slice(1)}`];
      shadow.querySelectorAll(`input[name="${key}"]`).forEach((input) => { input.checked = input.value === value; });
    }
    const selected = Number(data.aeSelectionCount) || 0;
    filterSummary.hidden = data.aeWorksHidden !== "true" || selected === 0;
    showWorks.textContent = `已筛选 ${selected} 部作品`;
    showWorks.title = "打开区域作品列表";
    shadow.getElementById("migration-note").hidden = data.aeWorksMigrated !== "true";
    let hiddenCount = 0;
    for (const [name, attribute] of Object.entries(markerAttributes)) {
      const hidden = data[attribute] === "true";
      menu.querySelector(`input[name="${name}"]`).checked = !hidden;
      if (hidden) hiddenCount++;
    }
    markers.dataset.filtered = String(hiddenCount > 0);
    markers.dataset.allHidden = String(hiddenCount === Object.keys(markerAttributes).length);
    markers.title = hiddenCount ? `地图标记（已隐藏 ${hiddenCount} 项）` : "地图标记";
    scheduleLayout();
  }

  async function save(value) {
    const current = ++revision;
    status.textContent = "正在保存…";
    try {
      await chrome.storage.local.set(value);
      if (current === revision) status.textContent = "已保存，立即生效";
    } catch {
      if (current === revision) {
        status.textContent = chrome.runtime?.id ? "保存失败，请重试。" : "扩展已更新，请刷新地图后重试。";
        render();
      }
    }
    scheduleLayout();
  }

  function setOpen(open, focus = true) {
    panel.hidden = !open;
    host.dataset.open = String(open);
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      setMenuOpen(false, false);
      render();
      layout();
      if (focus) shadow.querySelector('input[name="display"]:checked')?.focus({ preventScroll: true });
    } else if (focus) launcher.focus({ preventScroll: true });
  }

  function setMenuOpen(open, focus = true) {
    menu.hidden = !open;
    host.dataset.menuOpen = String(open);
    markers.setAttribute("aria-expanded", String(open));
    if (open) {
      setOpen(false, false);
      render();
      layout();
      if (focus) menu.querySelector("input")?.focus({ preventScroll: true });
    } else if (focus) markers.focus({ preventScroll: true });
  }

  function visibleRect(node) {
    const rect = node?.getBoundingClientRect();
    return rect?.width && rect.height && rect.top < innerHeight && rect.bottom > 0 ? rect : null;
  }

  function layout() {
    frame = 0;
    const controls = [...document.querySelectorAll(controlSelector)];
    const anchors = [...controls, ...document.querySelectorAll(".side-search-form, .window-points-box")];
    for (const node of observed) {
      if (anchors.includes(node)) continue;
      resize.unobserve(node);
      observed.delete(node);
    }
    for (const node of anchors) {
      if (!observed.has(node)) { observed.add(node); resize.observe(node); }
    }
    const rects = controls.map(visibleRect).filter(Boolean).sort((a, b) => a.top - b.top);
    const anchor = rects[0];
    const size = anchor?.width || 29;
    const gap = rects.length > 1 ? Math.max(8, Math.min(12, rects[1].top - anchor.bottom)) : 9;
    host.style.setProperty("--control-size", `${size}px`);
    host.style.setProperty("--control-gap", `${gap}px`);
    const height = controlsBox.offsetHeight;
    const anchorTop = anchor?.top ?? innerHeight - 164;
    const right = anchor ? Math.max(4, innerWidth - anchor.right) : 10;
    let top = Math.max(12, Math.min(innerHeight - height - 12, anchorTop - height - gap));
    let inset = right;
    const search = visibleRect(document.querySelector(".side-search-form"));
    if (search && top < search.bottom + 8 && innerWidth - right - launcher.offsetWidth < search.right) {
      top = innerHeight - height - 12;
      inset = right + size + gap;
    }
    host.style.top = `${top}px`;
    host.style.right = `${inset}px`;
    host.style.bottom = "auto";
    if (!filterSummary.hidden) {
      const left = search?.left ?? 10;
      let top = (search?.bottom ?? 12) + 8;
      const gallery = visibleRect(document.querySelector(".window-points-box"));
      if (gallery && gallery.top < innerHeight * .6 && gallery.left < left + 280) top = Math.max(top, gallery.bottom + 8);
      filterSummary.style.left = `${Math.max(12, Math.min(left, innerWidth - filterSummary.offsetWidth - 12))}px`;
      filterSummary.style.top = `${Math.max(12, Math.min(top, innerHeight - filterSummary.offsetHeight - 12))}px`;
    }
    for (const [popover, trigger] of [[panel, launcher], [menu, markers]]) {
      if (popover.hidden) continue;
      const button = trigger.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const left = button.left >= width + 22 ? button.left - width - 10 : innerWidth - width - 12;
      popover.style.left = `${Math.max(12, left)}px`;
      popover.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, button.bottom - height))}px`;
    }
  }

  function scheduleLayout() {
    if (!frame) frame = requestAnimationFrame(layout);
  }

  const on = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: events.signal });
  on(launcher, "click", () => setOpen(panel.hidden));
  on(host, "ae-settings-open", () => setOpen(true));
  on(markers, "click", () => setMenuOpen(menu.hidden));
  on(showWorks, "click", () => { document.documentElement.dataset.aeWorksHidden = "false"; });
  on(shadow.getElementById("clearFilter"), "click", () => document.dispatchEvent(new Event("ae-work-list-clear")));
  on(shadow.getElementById("close"), "click", () => setOpen(false));
  on(shadow, "change", (event) => {
    const input = event.target;
    if (input.matches('input[type="radio"]') && input.checked) save({ [input.name]: input.value });
    if (input.matches('input[type="checkbox"]') && markerAttributes[input.name]) {
      document.documentElement.dataset[markerAttributes[input.name]] = String(!input.checked);
    }
  });
  on(document, "pointerdown", (event) => {
    if (event.composedPath().includes(host)) return;
    if (!panel.hidden) setOpen(false, false);
    if (!menu.hidden) setMenuOpen(false, false);
  }, { capture: true });
  on(document, "keydown", (event) => {
    if (event.key === "Escape" && (!panel.hidden || !menu.hidden)) {
      event.preventDefault();
      event.stopPropagation();
      if (!menu.hidden) setMenuOpen(false);
      else setOpen(false);
    }
  }, { capture: true });
  for (const type of ["pointerdown", "mousedown", "touchstart", "touchmove", "click", "dblclick", "keydown", "keyup"]) {
    on(host, type, (event) => event.stopPropagation());
  }
  on(host, "wheel", (event) => {
    event.stopPropagation();
    if (!event.ctrlKey && !event.metaKey && (panel.hidden && menu.hidden)) event.preventDefault();
  }, { passive: false });
  on(window, "resize", scheduleLayout);

  const settings = new MutationObserver(render);
  settings.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ae-display", "data-ae-position", "data-ae-language", "data-ae-dots-hidden", "data-ae-avatars-hidden", "data-ae-names-hidden", "data-ae-thumbnails-hidden", "data-ae-works-hidden", "data-ae-selection-count", "data-ae-works-migrated"] });
  const resize = new ResizeObserver(scheduleLayout);
  resize.observe(panel);
  resize.observe(menu);
  resize.observe(filterSummary);
  const anchors = new MutationObserver(scheduleLayout);
  anchors.observe(document.body, { childList: true, subtree: true });
  const getManifest = chrome.runtime.getManifest.bind(chrome.runtime);
  globalThis.__aePageSettingsAlive = () => {
    try { getManifest(); return host.isConnected; } catch { return false; }
  };
  on(host, "ae-settings-dispose", () => {
    events.abort();
    settings.disconnect();
    resize.disconnect();
    anchors.disconnect();
    cancelAnimationFrame(frame);
    thumbnailStyle.remove();
    host.remove();
  });
  document.head.append(thumbnailStyle);
  document.body.append(host);
  render();
  setOpen(wasOpen, false);
  if (menuWasOpen && !wasOpen) setMenuOpen(true, false);
  layout();
})();
