import type { ProviderName } from "../config.js";

export interface MapPageOptions {
  provider: ProviderName;
  kakaoJsKey: string | null;
  lang: "ko" | "en";
}

/**
 * HTML page loaded by the app's WebView (native) or iframe (web). Both providers implement the
 * same message protocol (MapInboundMessage / MapOutboundMessage in docs/openapi.yaml), so the app
 * never knows which one is active.
 */
export function renderMapPage(o: MapPageOptions): string {
  const cfg = JSON.stringify({ provider: o.provider, lang: o.lang });
  const head =
    o.provider === "kakao"
      ? `<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(o.kakaoJsKey ?? "")}&autoload=false"></script>`
      : `<link rel="stylesheet" href="/static/leaflet/leaflet.css"><script src="/static/leaflet/leaflet.js"></script>`;
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>EV map</title>
${head}
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e8eef1; font-family: -apple-system, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
  .mk { display: flex; align-items: center; gap: 2px; min-width: 34px; height: 30px; padding: 0 7px; border-radius: 15px; border: 2px solid #fff;
        color: #fff; font-weight: 700; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,.35); cursor: pointer; transform: translate(-50%, -50%);
        box-sizing: border-box; justify-content: center; white-space: nowrap; user-select: none; -webkit-user-select: none; }
  .leaflet-marker-icon .mk { transform: none; }
  .mk.available { background: #16a34a; }
  .mk.reserved { background: #d97706; }
  .mk.unavailable { background: #6b7280; }
  .mk.selected { outline: 3px solid #1d4ed8; outline-offset: 1px; z-index: 1000; }
  .me { width: 16px; height: 16px; border-radius: 50%; background: #2563eb; border: 3px solid #fff; box-shadow: 0 0 0 6px rgba(37,99,235,.25); transform: translate(-50%, -50%); box-sizing: border-box; }
  .leaflet-marker-icon .me { transform: none; }
  .pin { width: 28px; height: 36px; line-height: 0; transform: translate(-50%, -100%); filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); pointer-events: none; }
  .leaflet-marker-icon .pin { transform: none; }
  .pin svg { display: block; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .leaflet-div-icon { background: transparent; border: none; }
  .leaflet-overlay-pane path { cursor: pointer; }
  #err { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; text-align: center; padding: 24px; color: #374151; font-size: 15px; }
</style>
</head>
<body>
<div id="map" role="application" aria-label="${o.lang === "ko" ? "충전소 지도" : "Charging station map"}"></div>
<div id="err"></div>
<div id="sr" class="sr" aria-live="polite"></div>
<script>
(function () {
  var CFG = ${cfg};
  var ICON = { available: "\\u2713", reserved: "\\u23F1", unavailable: "\\u2715" };

  function post(msg) {
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(JSON.stringify({ __evmap: true, msg: msg }), "*");
  }
  function fail(m) {
    var e = document.getElementById("err"); e.style.display = "flex"; e.textContent = m; post({ type: "error", message: String(m) });
  }
  window.onerror = function (m) { post({ type: "error", message: String(m) }); };

  function markerHtml(m) {
    var el = document.createElement("div");
    el.className = "mk " + m.status + (m.selected ? " selected" : "");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", m.a11y || m.label);
    el.textContent = (ICON[m.status] || "") + " " + m.label;
    el.addEventListener("click", function (ev) { ev.stopPropagation(); post({ type: "markerPress", id: m.id }); });
    el.addEventListener("touchstart", function (ev) { ev.stopPropagation(); }, { passive: true });
    return el;
  }
  var ignoreClickUntil = 0;
  function suppressMapClick() { ignoreClickUntil = Date.now() + 700; }
  function noteMapClick(lat, lng) {
    if (Date.now() < ignoreClickUntil || window.__ignoreMapClick) { window.__ignoreMapClick = false; return; }
    post({ type: "mapClick", lat: lat, lng: lng });
  }
  function pinHtml(m) {
    // Blue (#2563eb) and white, same colors as the user dot. Both providers share this overlay.
    var el = document.createElement("div");
    el.className = "pin";
    el.innerHTML = '<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true"><path d="M14 34.5C14 34.5 3 22.2 3 13.2a11 11 0 1 1 22 0C25 22.2 14 34.5 14 34.5z" fill="#2563eb" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="13.2" r="4.4" fill="#ffffff"/></svg>';
    if (m.a11y) { el.setAttribute("role", "img"); el.setAttribute("aria-label", m.a11y); }
    el.addEventListener("touchstart", function (ev) { ev.stopPropagation(); }, { passive: true });
    el.addEventListener("contextmenu", function (ev) { ev.stopPropagation(); ev.preventDefault(); });
    return el;
  }
  function div(cls, text) { var d = document.createElement("div"); d.className = cls; if (text) d.textContent = text; return d; }

  var FILL = { available: "#16a34a", reserved: "#d97706", unavailable: "#6b7280" };
  var districtGeoPromise = null;
  function loadDistrictGeo() {
    if (!districtGeoPromise) {
      districtGeoPromise = fetch("/static/geo/seoul-districts.geojson").then(function (r) {
        if (!r.ok) throw new Error("district boundaries failed to load");
        return r.json();
      }).catch(function (e) { districtGeoPromise = null; throw e; });
    }
    return districtGeoPromise;
  }
  function districtByCode(list) {
    var by = {};
    (list || []).forEach(function (d) { by[d.code] = d; });
    return by;
  }

  // Long-press detection shared by both providers (neither SDK exposes a reliable touch long-press).
  function attachLongPress(container, toLatLng) {
    var timer = null, start = null;
    function clear() { if (timer) clearTimeout(timer); timer = null; }
    container.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return clear();
      var t = e.touches[0]; var r = container.getBoundingClientRect();
      start = { x: t.clientX - r.left, y: t.clientY - r.top };
      clear();
      timer = setTimeout(function () { var ll = toLatLng(start.x, start.y); if (ll) { suppressMapClick(); post({ type: "longPress", lat: ll.lat, lng: ll.lng }); } timer = null; }, 600);
    }, { passive: true });
    container.addEventListener("touchmove", function (e) {
      if (!start || !timer) return; var t = e.touches[0]; var r = container.getBoundingClientRect();
      if (Math.abs(t.clientX - r.left - start.x) > 8 || Math.abs(t.clientY - r.top - start.y) > 8) clear();
    }, { passive: true });
    container.addEventListener("touchend", clear);
    container.addEventListener("contextmenu", function (e) {
      e.preventDefault(); var r = container.getBoundingClientRect();
      var ll = toLatLng(e.clientX - r.left, e.clientY - r.top); if (ll) { suppressMapClick(); post({ type: "longPress", lat: ll.lat, lng: ll.lng }); }
    });
  }

  var adapter;

  function leafletAdapter() {
    if (!window.L) return fail("Map library failed to load");
    var map = L.map("map", { zoomControl: false, attributionControl: true }).setView([37.5663, 126.9779], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    var layer = L.layerGroup().addTo(map), me = null, pin = null, circle = null, route = null, districts = null, districtToken = 0, districtsFitted = false;
    function icon(el) { return L.divIcon({ html: el, className: "", iconSize: null }); }
    map.on("moveend", function () { var c = map.getCenter(); post({ type: "regionChange", lat: c.lat, lng: c.lng }); });
    map.on("click", function (e) { noteMapClick(e.latlng.lat, e.latlng.lng); });
    attachLongPress(map.getContainer(), function (x, y) { var ll = map.containerPointToLatLng([x, y]); return { lat: ll.lat, lng: ll.lng }; });
    map.off("contextmenu");
    return {
      setCenter: function (m) { map.setView([m.lat, m.lng], m.zoom || map.getZoom()); },
      fitBounds: function (b) { map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [16, 16] }); },
      setMarkers: function (list) {
        layer.clearLayers();
        list.forEach(function (m) {
          var el = markerHtml(m);
          var mk = L.marker([m.lat, m.lng], { icon: icon(el), keyboard: true, title: m.a11y || m.label, zIndexOffset: m.selected ? 1000 : 0 });
          layer.addLayer(mk);
        });
      },
      setUserLocation: function (m) {
        if (me) { map.removeLayer(me); me = null; }
        if (m.lat != null) me = L.marker([m.lat, m.lng], { icon: icon(div("me")), interactive: false }).addTo(map);
      },
      setPin: function (m) {
        if (pin) { map.removeLayer(pin); pin = null; }
        if (m.lat == null) return;
        pin = L.marker([m.lat, m.lng], {
          icon: L.divIcon({ html: pinHtml(m), className: "", iconSize: [28, 36], iconAnchor: [14, 36] }),
          interactive: false, keyboard: false, zIndexOffset: 2000,
        }).addTo(map);
      },
      setRadius: function (m) {
        if (circle) { map.removeLayer(circle); circle = null; }
        if (m.radius_m > 0 && m.lat != null) circle = L.circle([m.lat, m.lng], { radius: m.radius_m, color: "#2563eb", weight: 1, fillOpacity: 0.05, interactive: false }).addTo(map);
      },
      setRoute: function (m) {
        if (route) { map.removeLayer(route); route = null; }
        if (!m.path || m.path.length < 2) return;
        route = L.layerGroup([
          L.polyline(m.path, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false }),
          L.polyline(m.path, { color: "#1d4ed8", weight: 5, opacity: 0.95, interactive: false }),
        ]).addTo(map);
        if (m.fit) map.fitBounds(L.latLngBounds(m.path), { padding: [36, 36] });
      },
      setDistricts: function (m) {
        var token = ++districtToken;
        loadDistrictGeo().then(function (geo) {
          if (token !== districtToken) return;
          if (districts) { map.removeLayer(districts); districts = null; }
          if (!m.districts || !m.districts.length) return;
          var by = districtByCode(m.districts);
          districts = L.geoJSON(geo, {
            filter: function (f) { return !!by[f.properties.SIG_CD]; },
            style: function (f) {
              var d = by[f.properties.SIG_CD];
              return { color: d.selected ? "#1d4ed8" : "#ffffff", weight: d.selected ? 3 : 1.5, fillColor: FILL[d.status] || FILL.unavailable, fillOpacity: d.selected ? 0.72 : 0.55 };
            },
            onEachFeature: function (f, lyr) {
              var d = by[f.properties.SIG_CD];
              lyr.on("click", function (e) {
                if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                window.__ignoreMapClick = true;
                post({ type: "districtPress", code: f.properties.SIG_CD });
              });
              lyr.on("add", function () {
                var el = lyr.getElement();
                if (!el || !d) return;
                el.setAttribute("role", "button");
                el.setAttribute("aria-label", d.a11y || f.properties.SIG_KOR_NM);
                if (d.selected) el.setAttribute("aria-current", "true");
              });
            },
          }).addTo(map);
          if (m.fit || !districtsFitted) { map.fitBounds(districts.getBounds(), { padding: [12, 12] }); districtsFitted = true; }
        }).catch(function (e) { post({ type: "error", message: String(e) }); });
      },
    };
  }

  function kakaoAdapter(done) {
    if (!window.kakao || !kakao.maps) return fail("Kakao Maps SDK failed to load (check KAKAO_JS_KEY and the registered domain)");
    kakao.maps.load(function () {
      var container = document.getElementById("map");
      var map = new kakao.maps.Map(container, { center: new kakao.maps.LatLng(37.5663, 126.9779), level: 5 });
      var overlays = [], me = null, pin = null, circle = null, route = [], districtPolys = [], districtToken = 0, districtsFitted = false;
      function toLevel(zoom) { return Math.max(1, Math.min(14, Math.round(19 - (zoom || 14)))); }
      kakao.maps.event.addListener(map, "idle", function () { var c = map.getCenter(); post({ type: "regionChange", lat: c.getLat(), lng: c.getLng() }); });
      kakao.maps.event.addListener(map, "click", function (mouseEvent) { var ll = mouseEvent.latLng; noteMapClick(ll.getLat(), ll.getLng()); });
      attachLongPress(container, function (x, y) {
        var ll = map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(x, y)); return { lat: ll.getLat(), lng: ll.getLng() };
      });
      function overlay(el, lat, lng, z) { var o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(lat, lng), content: el, xAnchor: 0, yAnchor: 0, zIndex: z || 1 }); o.setMap(map); return o; }
      done({
        setCenter: function (m) { if (m.zoom) map.setLevel(toLevel(m.zoom)); map.setCenter(new kakao.maps.LatLng(m.lat, m.lng)); },
        fitBounds: function (b) { map.setBounds(new kakao.maps.LatLngBounds(new kakao.maps.LatLng(b.south, b.west), new kakao.maps.LatLng(b.north, b.east))); },
        setMarkers: function (list) {
          overlays.forEach(function (o) { o.setMap(null); }); overlays = [];
          list.forEach(function (m) { overlays.push(overlay(markerHtml(m), m.lat, m.lng, m.selected ? 10 : 2)); });
        },
        setUserLocation: function (m) { if (me) me.setMap(null); me = m.lat != null ? overlay(div("me"), m.lat, m.lng, 3) : null; },
        setPin: function (m) {
          if (pin) pin.setMap(null); pin = null;
          if (m.lat == null) return;
          pin = overlay(pinHtml(m), m.lat, m.lng, 4);
        },
        setRadius: function (m) {
          if (circle) circle.setMap(null); circle = null;
          if (m.radius_m > 0 && m.lat != null) {
            circle = new kakao.maps.Circle({ center: new kakao.maps.LatLng(m.lat, m.lng), radius: m.radius_m, strokeWeight: 1, strokeColor: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.05 });
            circle.setMap(map);
          }
        },
        setRoute: function (m) {
          route.forEach(function (l) { l.setMap(null); }); route = [];
          if (!m.path || m.path.length < 2) return;
          var pts = m.path.map(function (p) { return new kakao.maps.LatLng(p[0], p[1]); });
          route.push(new kakao.maps.Polyline({ path: pts, strokeWeight: 9, strokeColor: "#ffffff", strokeOpacity: 0.9, zIndex: 1 }));
          route.push(new kakao.maps.Polyline({ path: pts, strokeWeight: 5, strokeColor: "#1d4ed8", strokeOpacity: 0.95, zIndex: 2 }));
          route.forEach(function (l) { l.setMap(map); });
          if (m.fit) { var b = new kakao.maps.LatLngBounds(); pts.forEach(function (p) { b.extend(p); }); map.setBounds(b, 36, 36, 36, 36); }
        },
        setDistricts: function (m) {
          var token = ++districtToken;
          loadDistrictGeo().then(function (geo) {
            if (token !== districtToken) return;
            districtPolys.forEach(function (p) { p.setMap(null); });
            districtPolys = [];
            if (!m.districts || !m.districts.length) return;
            var by = districtByCode(m.districts);
            var bounds = new kakao.maps.LatLngBounds();
            var any = false;
            geo.features.forEach(function (f) {
              var d = by[f.properties.SIG_CD];
              if (!d || !f.geometry) return;
              var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
              polys.forEach(function (rings) {
                var path = rings.map(function (ring) {
                  return ring.map(function (c) {
                    var ll = new kakao.maps.LatLng(c[1], c[0]);
                    bounds.extend(ll);
                    any = true;
                    return ll;
                  });
                });
                var polygon = new kakao.maps.Polygon({
                  path: path,
                  strokeWeight: d.selected ? 3 : 1.5,
                  strokeColor: d.selected ? "#1d4ed8" : "#ffffff",
                  strokeOpacity: 1,
                  fillColor: FILL[d.status] || FILL.unavailable,
                  fillOpacity: d.selected ? 0.72 : 0.55,
                  zIndex: d.selected ? 2 : 1,
                });
                polygon.setMap(map);
                kakao.maps.event.addListener(polygon, "click", function () {
                  window.__ignoreMapClick = true;
                  post({ type: "districtPress", code: f.properties.SIG_CD });
                });
                districtPolys.push(polygon);
              });
            });
            if (any && (m.fit || !districtsFitted)) { map.setBounds(bounds, 12, 12, 12, 12); districtsFitted = true; }
          }).catch(function (e) { post({ type: "error", message: String(e) }); });
        },
      });
    });
  }

  var queue = [];
  function handle(msg) {
    if (typeof msg === "string") { try { msg = JSON.parse(msg); } catch (e) { return; } }
    if (msg && msg.__evapp) msg = msg.msg;
    if (!msg || !msg.type) return;
    if (!adapter) { queue.push(msg); return; }
    var fn = adapter[msg.type];
    if (fn) { try { fn(msg.type === "setMarkers" ? msg.markers : msg.type === "fitBounds" ? msg.bbox : msg); } catch (e) { post({ type: "error", message: String(e) }); } }
  }
  window.__onAppMessage = handle;
  window.addEventListener("message", function (e) { handle(e.data); });
  document.addEventListener("message", function (e) { handle(e.data); });

  function ready(a) { adapter = a; post({ type: "ready", provider: CFG.provider }); queue.splice(0).forEach(handle); }
  if (CFG.provider === "kakao") kakaoAdapter(ready); else { var a = leafletAdapter(); if (a) ready(a); }
})();
</script>
</body>
</html>`;
}
