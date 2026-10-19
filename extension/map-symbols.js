(() => {
  if (!/\/map(?:\/|$)/.test(location.pathname) || globalThis.__aeMapSymbols) return;
  globalThis.__aeMapSymbols = true;
  const layerId = "bangumis";
  const properties = { "icon-image": "aeAvatarsHidden", "text-field": "aeNamesHidden" };
  const events = ["styledata", "style.load", "idle"];
  const restore = new Map();
  let map;
  let applying = false;

  function apply() {
    if (!map || applying) return;
    applying = true;
    try {
      const layer = map.getLayer(layerId);
      if (layer?.type !== "symbol" || layer.source !== "bangumis") {
        restore.clear();
        return;
      }
      // Empty symbol content removes its rendered shape and hit target. Opacity
      // alone would leave invisible markers intercepting map clicks.
      for (const [property, attribute] of Object.entries(properties)) {
        const hidden = document.documentElement.dataset[attribute] === "true";
        const current = map.getLayoutProperty(layerId, property);
        if (hidden && current !== "") {
          restore.set(property, current ?? null);
          map.setLayoutProperty(layerId, property, "");
        } else if (!hidden && restore.has(property)) {
          const previous = restore.get(property);
          restore.delete(property);
          if (current === "") map.setLayoutProperty(layerId, property, previous);
        }
      }
    } finally { applying = false; }
  }

  function bindMap() {
    const next = window.mapApp?.map;
    if (!next?.getLayer || !next.getLayoutProperty || !next.setLayoutProperty || !next.on) return;
    if (next !== map) {
      for (const event of events) map?.off(event, apply);
      map = next;
      restore.clear();
      for (const event of events) map.on(event, apply);
    }
    apply();
  }

  new MutationObserver(bindMap).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-ae-avatars-hidden", "data-ae-names-hidden"],
  });
  setInterval(bindMap, 1000);
  bindMap();
})();
