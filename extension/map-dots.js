(() => {
  if (!/\/map(?:\/|$)/.test(location.pathname) || globalThis.__aeMapDots) return;
  globalThis.__aeMapDots = true;
  const layerId = "bangumi-point";
  const sourceLayerId = "ae-points-source";
  const events = ["styledata", "style.load", "idle"];
  let map;
  let restore;
  let applying = false;

  function apply() {
    if (!map || applying) return;
    applying = true;
    try {
      const layer = map.getLayer(layerId);
      const eligible = layer?.type === "circle" && layer.source === "points";
      const hidden = document.documentElement.dataset.aeDotsHidden === "true";
      if ((!hidden || !eligible) && map.getLayer(sourceLayerId)) map.removeLayer(sourceLayerId);
      // Only the site's pilgrimage dots; symbols and basemap circles stay intact.
      if (!eligible) { restore = undefined; return; }
      if (hidden && !map.getLayer(sourceLayerId)) {
        // An unused source stops updating its tiles. Keep it active for regional
        // counts/thumbnails with a layer that draws and hit-tests no features.
        map.addLayer({ id: sourceLayerId, type: "circle", source: "points",
          filter: ["==", ["literal", 1], 0], paint: { "circle-radius": 0 } }, layerId);
      }
      const current = map.getLayoutProperty(layerId, "visibility");
      if (hidden && current !== "none") {
        restore = current ?? null;
        map.setLayoutProperty(layerId, "visibility", "none");
      } else if (!hidden && restore !== undefined) {
        const previous = restore;
        restore = undefined;
        if (current === "none") map.setLayoutProperty(layerId, "visibility", previous);
      }
    } finally { applying = false; }
  }

  function bindMap() {
    const next = window.mapApp?.map;
    if (!next?.getLayer || !next.getLayoutProperty || !next.setLayoutProperty || !next.addLayer || !next.removeLayer || !next.on) return;
    if (next !== map) {
      for (const event of events) map?.off(event, apply);
      map = next;
      restore = undefined;
      for (const event of events) map.on(event, apply);
    }
    apply();
  }

  new MutationObserver(bindMap).observe(document.documentElement, {
    attributes: true, attributeFilter: ["data-ae-dots-hidden"],
  });
  // The map is created asynchronously and can be replaced when changing maps.
  setInterval(bindMap, 1000);
  bindMap();
})();
