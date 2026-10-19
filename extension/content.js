(() => {
  document.documentElement.dataset.aeReady = "true";
  const itemSelector = ".window-bangumi-item";
  const toolbarSelector = ".window-bangumis-box";
  const layoutAnchorSelector = ".window-points-box, .side-search-form, .func-change-logs-fixed, .mapboxgl-ctrl-bottom-left, .maplibregl-ctrl-bottom-left";
  const originalAttributes = new WeakMap();
  const originalToolbarTop = new WeakMap();
  const navigation = new WeakMap();
  const layoutAnchors = new Set();
  let timer;
  let retry;
  let retryCount = 0;

  function imageKey(value) {
    if (typeof value !== "string" || !value || value.startsWith("blob:")) return "";
    try {
      return new URL(value, location.href).pathname.replace(/^\/images\//, "/");
    } catch {
      return "";
    }
  }

  function indexWorks() {
    const images = new Map();
    const colors = new Map();
    for (const work of Object.values(window.mapApp?.BangumiIds || {})) {
      if (!work || !work.id) continue;
      for (const url of [work.icon, work.cover]) {
        const key = imageKey(url);
        if (!key) continue;
        if (!images.has(key)) images.set(key, new Set());
        images.get(key).add(work);
      }
      const color = (work.color || "#222").trim().toLowerCase();
      if (!colors.has(color)) colors.set(color, new Set());
      colors.get(color).add(work);
    }
    return { images, colors };
  }

  function findWork(item, index) {
    // Region entries are created from known work IDs, so they do not need the
    // image matching used for the site's original nodes.
    if (item.closest('[data-ae-region="true"]')) {
      return window.mapApp?.BangumiIds?.[item.dataset.aeWorkId] || null;
    }
    const image = item.querySelector("img.cover");
    const color = item.style.getPropertyValue("--bangumi-color").trim().toLowerCase();
    const candidates = index.images.get(imageKey(image?.getAttribute("src")));
    if (candidates?.size === 1) return [...candidates][0];
    // The site sometimes renders third-party covers as blob URLs. Only use a
    // color when it identifies exactly one work in the entire loaded dataset.
    if (image?.src.startsWith("blob:") && index.colors.get(color)?.size === 1) {
      return [...index.colors.get(color)][0];
    }
    return null;
  }

  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function clearItem(item) {
    item.querySelectorAll(".ae-name, .ae-count").forEach((node) => node.remove());
    item.classList.remove("ae-item");
    const original = originalAttributes.get(item);
    if (!original) return;
    for (const [name, value] of Object.entries(original)) {
      if (value === null) item.removeAttribute(name);
      else setAttribute(item, name, value);
    }
    originalAttributes.delete(item);
  }

  function enhanceItem(item, work) {
    const preferJapanese = document.documentElement.dataset.aeLanguage === "ja";
    const name = String((preferJapanese ? work.title || work.cn : work.cn || work.title) || work.en || "").trim();
    if (!name) {
      clearItem(item);
      return;
    }
    if (!originalAttributes.has(item)) {
      originalAttributes.set(item, Object.fromEntries(
        ["title", "role", "tabindex", "aria-label", "aria-pressed"].map((key) => [key, item.getAttribute(key)]),
      ));
    }
    item.classList.add("ae-item");
    let label = item.querySelector(".ae-name");
    let count = item.querySelector(".ae-count");
    if (!label) {
      label = document.createElement("span");
      label.className = "ae-name";
      label.setAttribute("aria-hidden", "true");
      item.append(label);
    }
    if (!count) {
      count = document.createElement("span");
      count.className = "ae-count";
      count.setAttribute("aria-hidden", "true");
      item.append(count);
    }
    const number = /^\d+$/.test(item.dataset.num || "") ? item.dataset.num : "";
    setText(label, name);
    setText(count, number);
    const names = [...new Set([name, work.cn, work.title].filter(Boolean))].join("\n");
    const countText = number ? `当前区域 ${number} 个点位` : "";
    setAttribute(item, "title", [names, countText, "点击筛选，可多选"].filter(Boolean).join("\n"));
    setAttribute(item, "role", "button");
    setAttribute(item, "tabindex", "0");
    setAttribute(item, "aria-label", [name, countText].filter(Boolean).join("，"));
    setAttribute(item, "aria-pressed", String(item.dataset.selected === "true"));
  }

  function visibleBounds(element) {
    if (!element || element.hidden || !element.getClientRects().length || getComputedStyle(element).visibility === "hidden") return null;
    const bounds = element.getBoundingClientRect();
    return bounds.width && bounds.height && bounds.right > 0 && bounds.bottom > 0
      && bounds.left < innerWidth && bounds.top < innerHeight ? bounds : null;
  }

  function fitSidebar(toolbar) {
    const left = 10;
    const width = Math.min(280, innerWidth - left - 12);
    let top = 12;
    let bottom = innerHeight - 12;
    const intersects = (bounds) => bounds && bounds.left < left + width && bounds.right > left;
    const search = visibleBounds(document.querySelector(".side-search-form"));
    if (intersects(search)) top = Math.max(top, search.bottom + 8);
    const gallery = visibleBounds(document.querySelector(".window-points-box"));
    if (intersects(gallery)) {
      // The mobile site places thumbnails at the bottom of the map.
      if (gallery.top >= innerHeight * .6) bottom = Math.min(bottom, gallery.top - 8);
      else top = Math.max(top, gallery.bottom + 8);
    }
    for (const element of document.querySelectorAll(".mapboxgl-ctrl-bottom-left, .maplibregl-ctrl-bottom-left")) {
      const controls = visibleBounds(element);
      if (intersects(controls)) bottom = Math.min(bottom, controls.top - 8);
    }
    const notice = visibleBounds(document.querySelector(".func-change-logs-fixed"));
    if (intersects(notice) && notice.top < bottom && notice.bottom > top) top = notice.bottom + 8;
    // Keep the saved preference, but use the top row if the window is too short
    // to fit even two works between the site's existing controls.
    if (width < 140 || bottom - top < 96) return false;
    toolbar.style.setProperty("--ae-sidebar-top", `${top}px`);
    toolbar.style.setProperty("--ae-available-width", `${width}px`);
    const footer = toolbar.querySelector(".ae-region-clear");
    const footerHeight = footer && !footer.hidden ? 34 : 0;
    toolbar.style.setProperty("--ae-available-height", `${bottom - top - footerHeight}px`);
    setAttribute(toolbar, "data-ae-layout", "left");
    return true;
  }

  function fitToolbar(toolbar) {
    if (toolbar.hidden || !toolbar.getClientRects().length) return;
    if (!originalToolbarTop.has(toolbar)) originalToolbarTop.set(toolbar, toolbar.style.top);
    if (document.documentElement.dataset.aePosition === "left" && fitSidebar(toolbar)) return;
    setAttribute(toolbar, "data-ae-layout", "top");
    toolbar.style.top = originalToolbarTop.get(toolbar);
    const rect = toolbar.getBoundingClientRect();
    let right = innerWidth - 12;
    const notice = document.querySelector(".func-change-logs-fixed");
    if (notice && !notice.hidden && notice.getClientRects().length) {
      const obstacle = notice.getBoundingClientRect();
      if (obstacle.left > rect.left && obstacle.top < rect.top + Math.max(68, rect.height) && obstacle.bottom > rect.top) {
        right = Math.min(right, obstacle.left - 12);
        // On narrow windows the announcement can occupy almost the entire row.
        // Put the works underneath it instead of shrinking names to zero width.
        if (right - rect.left < Math.min(220, innerWidth - 24)) {
          toolbar.style.top = `${obstacle.bottom + 8}px`;
          right = innerWidth - 12;
        }
      }
    }
    const width = `${Math.max(0, right - rect.left)}px`;
    if (toolbar.style.getPropertyValue("--ae-available-width") !== width) {
      toolbar.style.setProperty("--ae-available-width", width);
    }
  }

  function updateNavigation(state) {
    const { toolbar, list, shell, previous, next } = state;
    if (toolbar.hidden) return;
    const layout = toolbar.dataset.aeLayout;
    if (state.layout !== layout) {
      state.layout = layout;
      list.scrollTo({ left: 0, top: 0, behavior: "instant" });
    }
    if (layout === "left") {
      setAttribute(shell, "data-overflow", "false");
      previous.hidden = next.hidden = true;
      const remaining = Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop);
      const fadeTop = list.scrollTop > 1 ? Math.min(28, list.scrollTop) : 0;
      const fadeBottom = remaining > 1 ? Math.min(28, remaining) : 0;
      list.style.setProperty("--ae-fade-top", `${fadeTop}px`);
      list.style.setProperty("--ae-fade-bottom", `${fadeBottom}px`);
      setAttribute(list, "data-ae-fade", String(fadeTop > 0 || fadeBottom > 0));
      return;
    }
    list.removeAttribute("data-ae-fade");
    list.style.removeProperty("--ae-fade-top");
    list.style.removeProperty("--ae-fade-bottom");
    const available = Number.parseFloat(toolbar.style.getPropertyValue("--ae-available-width"));
    const overflow = list.scrollWidth > available + 1;
    setAttribute(shell, "data-overflow", String(overflow));
    previous.hidden = next.hidden = !overflow;
    if (!overflow) return;
    previous.disabled = list.scrollLeft <= 1;
    next.disabled = list.scrollWidth - list.clientWidth - list.scrollLeft <= 1;
    const bounds = list.getBoundingClientRect();
    const items = [...list.querySelectorAll(`${itemSelector}:not([hidden])`)];
    const before = items.filter((item) => item.getBoundingClientRect().left < bounds.left - 1).length;
    const after = items.filter((item) => item.getBoundingClientRect().right > bounds.right + 1).length;
    setAttribute(previous, "title", before ? `向左浏览作品（前面还有 ${before} 项）` : "已到开头");
    setAttribute(next, "title", after ? `向右浏览作品（后面还有 ${after} 项）` : "已到末尾");
  }

  function scrollWorks(state, direction) {
    const { list } = state;
    const bounds = list.getBoundingClientRect();
    const items = [...list.querySelectorAll(`${itemSelector}:not([hidden])`)];
    const target = direction > 0
      ? items.find((item) => item.getBoundingClientRect().right > bounds.right + 1)
      : items.reverse().find((item) => item.getBoundingClientRect().left < bounds.left - 1);
    if (!target) return;
    const left = list.scrollLeft + target.getBoundingClientRect().left - bounds.left - 2;
    list.scrollTo({ left, behavior: "instant" });
    updateNavigation(state);
  }

  function wheelWorks(state, event) {
    // Preserve browser zoom and trackpad pinch gestures. For ordinary scrolling,
    // consume events even at either edge so the map cannot unexpectedly zoom.
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const { list, toolbar } = state;
    const vertical = toolbar.dataset.aeLayout === "left";
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? (vertical ? list.clientHeight : list.clientWidth) : 1;
    list.scrollBy({ [vertical ? "top" : "left"]: delta * unit, behavior: "instant" });
    updateNavigation(state);
  }

  function ensureNavigation(toolbar) {
    const list = toolbar.querySelector(".window-bangumi-list");
    if (!list) return;
    let state = navigation.get(toolbar);
    if (state?.list !== list) {
      const shell = document.createElement("div");
      shell.className = "ae-scroller";
      const makeButton = (label, symbol) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ae-scroll-button";
        button.setAttribute("aria-label", label);
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = symbol;
        button.append(icon);
        button.hidden = true;
        return button;
      };
      const previous = makeButton("向左浏览作品", "‹");
      const next = makeButton("向右浏览作品", "›");
      if (state) state.shell.replaceWith(list);
      list.before(shell);
      shell.append(previous, list, next);
      state = { toolbar, list, shell, previous, next };
      navigation.set(toolbar, state);
      previous.addEventListener("click", (event) => {
        event.stopPropagation();
        scrollWorks(state, -1);
      });
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        scrollWorks(state, 1);
      });
      list.addEventListener("scroll", () => updateNavigation(state), { passive: true });
      shell.addEventListener("wheel", (event) => wheelWorks(state, event), { passive: false });
    }
    updateNavigation(state);
  }

  const observerOptions = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "hidden", "class", "data-num", "data-selected", "data-has-selection", "data-ae-language", "data-ae-display", "data-ae-position"],
  };

  function observeLayoutAnchors() {
    const current = new Set(document.querySelectorAll(layoutAnchorSelector));
    for (const element of layoutAnchors) {
      if (current.has(element)) continue;
      layoutObserver.unobserve(element);
      layoutAnchors.delete(element);
    }
    for (const element of current) {
      if (layoutAnchors.has(element)) continue;
      layoutObserver.observe(element);
      layoutAnchors.add(element);
    }
  }

  function refresh() {
    timer = undefined;
    clearTimeout(retry);
    observer.disconnect();
    let unresolved = false;
    try {
      observeLayoutAnchors();
      const index = indexWorks();
      for (const item of document.querySelectorAll(itemSelector)) {
        if (item.hidden || !item.closest(toolbarSelector) || item.closest(toolbarSelector).hidden) {
          clearItem(item);
          continue;
        }
        const work = findWork(item, index);
        if (work) enhanceItem(item, work);
        else {
          clearItem(item);
          unresolved = true;
        }
      }
      document.querySelectorAll(toolbarSelector).forEach((toolbar) => {
        fitToolbar(toolbar);
        ensureNavigation(toolbar);
      });
    } finally {
      observer.observe(document.documentElement, observerOptions);
    }
    // Cover and work data may arrive separately. Stop polling after 15 seconds;
    // subsequent DOM changes still trigger another attempt.
    if (unresolved && retryCount++ < 15) retry = setTimeout(refresh, 1000);
  }

  function schedule() {
    if (timer !== undefined) return;
    retryCount = 0;
    timer = setTimeout(refresh, 60);
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      const element = mutation.target;
      if (!(element instanceof Element)) return false;
      if (element === document.documentElement) return true;
      if (element.closest(`${toolbarSelector}, ${layoutAnchorSelector}`)) return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && (
        node.matches(`${toolbarSelector}, ${layoutAnchorSelector}`) || node.querySelector(`${toolbarSelector}, ${layoutAnchorSelector}`)
      ));
    })) schedule();
  });
  const layoutObserver = new ResizeObserver(schedule);

  document.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest(`${itemSelector}.ae-item`);
    if (!item || event.target !== item || event.repeat || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    item.click();
  });
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("visibilitychange", schedule);
  refresh();
})();
