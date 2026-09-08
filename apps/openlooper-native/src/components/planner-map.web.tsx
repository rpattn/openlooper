import { useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';

import { pulledSection } from '@/domain/route-positions';
import { waypointLabel, waypointMarker } from '@/domain/waypoints';
import type { Coordinate, MapStyleId, RouteIssue, Waypoint } from '@/domain/models';
import type { PlannerMapProps } from './planner-map.types';

type MapLibreModule = typeof import('maplibre-gl');
type Callbacks = Pick<
  PlannerMapProps,
  'onMapPress' | 'onWaypointPress' | 'onWaypointDelete' | 'onWaypointMove' | 'onIssuePress' | 'onEdgePress' | 'onAlternativePress' | 'onCameraChange' | 'onRouteDrag' | 'onBoundsChange'
>;
/** Layers that count as "the route" for the purpose of taking hold of it. */
const ROUTE_TARGETS = ['edges-hit', 'route-line'];
/** How far a pointer travels before a press on the route counts as a reshape
 * rather than a tap that happened to land on it. */
const DRAG_THRESHOLD = 6;
/** How long a finger rests on the route before it takes hold of it. Shorter and
 * a pan that starts on the line would be caught; longer and it feels stuck. */
const HOLD_MS = 380;
const WORKER_URL = 'https://unpkg.com/maplibre-gl@6.6.0/dist/maplibre-gl-worker.mjs';
// OpenFreeMap serves no imagery, so the web map offers vector styles only and
// falls back to the default style if an imagery mode reaches it anyway.
const STYLE_URL: Record<MapStyleId, string> = {
  standard: 'https://tiles.openfreemap.org/styles/liberty',
  muted: 'https://tiles.openfreemap.org/styles/positron',
  satellite: 'https://tiles.openfreemap.org/styles/liberty',
  hybrid: 'https://tiles.openfreemap.org/styles/liberty',
};
const collection = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});
/**
 * A reshape in progress. `origin` is the screen point the gesture began at, used
 * only to tell a reshape from a tap; `from` is the place on the route that was
 * taken hold of, which decides where the new point belongs in the order.
 */
type DragState = {
  from: Coordinate;
  origin: { x: number; y: number };
  /** The stretch of route being pulled, drawn either side of the cursor. */
  anchors: [Coordinate, Coordinate];
  /** True once the gesture owns the map: immediately for a pointer, after the
   * hold for a finger. */
  held: boolean;
  /** True once it has moved far enough to be a reshape rather than a tap. */
  active: boolean;
  touch: boolean;
  hold?: ReturnType<typeof setTimeout>;
};

const line = (points: Coordinate[], properties: GeoJSON.GeoJsonProperties = {}) => ({
  type: 'Feature' as const,
  properties,
  geometry: {
    type: 'LineString' as const,
    coordinates: points.map((point) => [point.lon, point.lat]),
  },
});

export function PlannerMap(props: PlannerMapProps) {
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const markers = useRef<MapLibre.Marker[]>([]);
  const marks = useRef<MapLibre.Marker[]>([]);
  const emittedCenter = useRef<Coordinate | undefined>(undefined);
  const appliedStyle = useRef<MapStyleId>(props.mapStyle);
  // Read through a ref so resizing the sheet never re-fits the route on its own.
  const inset = useRef({ bottom: props.bottomInset, left: props.leftInset });
  inset.current = { bottom: props.bottomInset, left: props.leftInset };
  const callbacks = useRef<Callbacks>(props);
  const snapshot = useRef(props);
  callbacks.current = props;
  snapshot.current = props;

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import('maplibre-gl')
      .then((module) => {
        if (cancelled || !container.current) return;
        module.setWorkerUrl(WORKER_URL);
        const instance = new module.Map({
          container: container.current,
          style: STYLE_URL[snapshot.current.mapStyle],
          center: [snapshot.current.camera.center.lon, snapshot.current.camera.center.lat],
          zoom: snapshot.current.camera.zoom,
          attributionControl: false,
        });
        map.current = instance;
        instance.addControl(new module.AttributionControl({ compact: true }), 'bottom-right');
        instance.addControl(new module.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('click', (event) => {
          const interactive = instance.queryRenderedFeatures(event.point, {
            layers: ['alternatives-hit', 'issues-hit', 'edges-hit'].filter((id) => instance.getLayer(id)),
          });
          if (snapshot.current.interaction === 'inspect') return;
          if (!interactive.length || snapshot.current.activeTool === 'add')
            callbacks.current.onMapPress({ lat: event.lngLat.lat, lon: event.lngLat.lng });
        });
        const reportBounds = () => {
          const bounds = instance.getBounds();
          callbacks.current.onBoundsChange([
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
          ]);
        };
        instance.on('moveend', () => {
          const center = instance.getCenter();
          emittedCenter.current = { lat: center.lat, lon: center.lng };
          callbacks.current.onCameraChange({ lat: center.lat, lon: center.lng }, instance.getZoom());
          reportBounds();
        });
        instance.on('error', (event) => {
          if (!instance.isStyleLoaded()) setError(event.error.message);
        });
        instance.on('load', () => {
          addLayers(instance);
          setReady(true);
          reportBounds();
          renderData(instance, snapshot.current);
          renderMarkers(module, instance, markers, snapshot.current.waypoints, snapshot.current.mode, snapshot.current.active, callbacks, snapshot.current.interaction === 'edit');
          instance.on('click', 'issues-hit', (event) => {
            if (snapshot.current.interaction === 'edit' && snapshot.current.activeTool === 'add') return;
            const id = event.features?.[0]?.properties?.id as string | undefined;
            if (id) callbacks.current.onIssuePress(id);
          });
          instance.on('click', 'edges-hit', (event) => {
            if (snapshot.current.interaction === 'edit' && snapshot.current.activeTool === 'add') return;
            const index = Number(event.features?.[0]?.properties?.index);
            if (Number.isFinite(index))
              callbacks.current.onEdgePress(index, { lat: event.lngLat.lat, lon: event.lngLat.lng });
          });
          instance.on('click', 'alternatives-hit', (event) => {
            if (snapshot.current.interaction === 'edit' && snapshot.current.activeTool === 'add') return;
            const id = event.features?.[0]?.properties?.id as string | undefined;
            if (id) callbacks.current.onAlternativePress(id);
          });
        });
        // Taking hold of the route line and pulling it is the one gesture that
        // reshapes a route without first choosing a tool. A pointer press on the
        // line starts it; a finger has to rest there first, so a pan that begins
        // on the route is still a pan.
        // A press on one of the route's own points belongs to that point: it
        // opens the point and offers to remove it. The markers sit over the map
        // in the DOM, so their presses reach here too and have to be let past.
        const onMarker = (event: { originalEvent: Event }) =>
          event.originalEvent.target instanceof Element &&
          !!event.originalEvent.target.closest('.maplibregl-marker');

        const overRoute = (point: { x: number; y: number }) =>
          snapshot.current.interaction === 'edit' &&
          !!snapshot.current.route &&
          instance.queryRenderedFeatures(point as never, {
            layers: ROUTE_TARGETS.filter((id) => instance.getLayer(id)),
          }).length > 0;

        const drawDrag = (to: Coordinate) => {
          const current = drag.current;
          if (!current) return;
          setSource(instance, 'drag', collection([line([current.anchors[0], to, current.anchors[1]])]));
          instance.getCanvas().style.cursor = 'grabbing';
        };

        const moveDrag = (to: Coordinate, point: { x: number; y: number }) => {
          const current = drag.current;
          if (!current?.held) return;
          if (!current.active) {
            const travelled = Math.hypot(point.x - current.origin.x, point.y - current.origin.y);
            if (travelled < DRAG_THRESHOLD) return;
            current.active = true;
          }
          drawDrag(to);
        };

        const endDrag = (to?: Coordinate) => {
          const current = drag.current;
          drag.current = undefined;
          if (!current) return;
          clearTimeout(current.hold);
          if (current.touch) instance.dragPan.enable();
          setSource(instance, 'drag', collection());
          instance.getCanvas().style.cursor = cursorFor(snapshot.current);
          if (current.active && to) callbacks.current.onRouteDrag(current.from, to);
        };

        instance.on('mousedown', (event) => {
          const route = snapshot.current.route;
          if (drag.current || !route || onMarker(event) || !overRoute(event.point)) return;
          // Stops the map panning out from under a route being reshaped. A press
          // that never moves still becomes a click, so tapping the line to
          // inspect it is unaffected.
          event.preventDefault();
          const from = { lat: event.lngLat.lat, lon: event.lngLat.lng };
          drag.current = {
            from,
            origin: { x: event.point.x, y: event.point.y },
            anchors: pulledSection(route.geometry, from),
            held: true,
            active: false,
            touch: false,
          };
        });
        instance.on('mousemove', (event) => {
          if (drag.current) {
            moveDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng }, event.point);
            return;
          }
          // A grab cursor is the only hint that the line can be pulled at all.
          instance.getCanvas().style.cursor =
            !onMarker(event) && overRoute(event.point) ? 'grab' : cursorFor(snapshot.current);
        });
        instance.on('mouseup', (event) => endDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng }));

        instance.on('touchstart', (event) => {
          const route = snapshot.current.route;
          if (drag.current || event.points.length !== 1 || !route) return;
          if (onMarker(event) || !overRoute(event.point)) return;
          const from = { lat: event.lngLat.lat, lon: event.lngLat.lng };
          const origin = { x: event.point.x, y: event.point.y };
          const hold = setTimeout(() => {
            const current = drag.current;
            if (!current) return;
            current.held = true;
            current.active = true;
            current.anchors = pulledSection(route.geometry, from);
            // Only now does the gesture stop being a pan, which is why the map
            // is left alone until the hold has actually completed.
            instance.dragPan.disable();
            drawDrag(from);
          }, HOLD_MS);
          drag.current = {
            from,
            origin,
            anchors: [from, from],
            held: false,
            active: false,
            touch: true,
            hold,
          };
        });
        instance.on('touchmove', (event) => {
          const current = drag.current;
          if (!current) return;
          if (!current.held) {
            const travelled = Math.hypot(
              event.point.x - current.origin.x,
              event.point.y - current.origin.y,
            );
            // Moving before the hold completes is a pan, not a reshape.
            if (travelled >= DRAG_THRESHOLD) {
              clearTimeout(current.hold);
              drag.current = undefined;
            }
            return;
          }
          event.preventDefault();
          moveDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng }, event.point);
        });
        instance.on('touchend', (event) => endDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
        instance.on('touchcancel', () => endDrag());

        renderMarkers(module, instance, markers, snapshot.current.waypoints, snapshot.current.mode, snapshot.current.active, callbacks, snapshot.current.interaction === 'edit');
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(container.current);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Map failed to start.'));
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    renderData(instance, props);
    void import('maplibre-gl').then((module) => {
      if (map.current !== instance) return;
      renderMarkers(module, instance, markers, props.waypoints, props.mode, props.active, callbacks, props.interaction === 'edit');
      renderDistanceMarks(module, instance, marks, props.markers);
    });
  }, [props, ready]);

  useEffect(() => {
    const instance = map.current;
    // Left to `renderData` this would fight the grab cursor the drag sets, which
    // is updated from pointer events rather than from a render.
    if (instance && ready && !drag.current) instance.getCanvas().style.cursor = cursorFor(props);
  }, [props, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || appliedStyle.current === props.mapStyle) return;
    appliedStyle.current = props.mapStyle;
    // Swapping the style drops every source and layer the planner added, so
    // they are rebuilt once the new style reports in.
    setReady(false);
    instance.setStyle(STYLE_URL[props.mapStyle]);
    instance.once('styledata', () => {
      if (map.current !== instance) return;
      addLayers(instance);
      renderData(instance, snapshot.current);
      setReady(true);
    });
  }, [props.mapStyle, ready]);

  useEffect(() => {
    const instance = map.current;
    const emitted = emittedCenter.current;
    if (!instance || (emitted && Math.abs(emitted.lat - props.camera.center.lat) < 0.00001 && Math.abs(emitted.lon - props.camera.center.lon) < 0.00001)) return;
    instance.flyTo({ center: [props.camera.center.lon, props.camera.center.lat], zoom: props.camera.zoom });
  }, [props.camera.center.lat, props.camera.center.lon, props.camera.zoom]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !props.route?.geometry.length) return;
    const coordinates = props.route.geometry;
    const west = Math.min(...coordinates.map((point) => point.lon));
    const east = Math.max(...coordinates.map((point) => point.lon));
    const south = Math.min(...coordinates.map((point) => point.lat));
    const north = Math.max(...coordinates.map((point) => point.lat));
    instance.fitBounds([[west, south], [east, north]], {
      padding: { top: 90, right: 60, bottom: inset.current.bottom + 40, left: inset.current.left + 60 },
      maxZoom: 16,
    });
  }, [props.fitRequest, props.route?.geometry, props.route?.id]);

  useEffect(() => {
    const instance = map.current;
    const coordinates = props.highlightedIssue?.geometry;
    if (!instance || !coordinates?.length) return;
    const west = Math.min(...coordinates.map((point) => point.lon));
    const east = Math.max(...coordinates.map((point) => point.lon));
    const south = Math.min(...coordinates.map((point) => point.lat));
    const north = Math.max(...coordinates.map((point) => point.lat));
    instance.fitBounds([[west, south], [east, north]], {
      padding: { top: 110, right: 70, bottom: inset.current.bottom + 60, left: inset.current.left + 70 },
      maxZoom: 17,
    });
  }, [props.highlightedIssue]);

  return (
    <div className="planner-map-shell">
      <div ref={container} className="planner-map" aria-label="Route planning map" />
      {!ready && (
        <div className={`map-status${error ? ' map-status--error' : ''}`} role="status">
          {error ? `Map unavailable: ${error}` : 'Loading map…'}
        </div>
      )}
    </div>
  );
}

function addLayers(map: MapLibre.Map) {
  map.addSource('use-evidence', { type: 'geojson', data: collection() });
  map.addSource('alternatives', { type: 'geojson', data: collection() });
  map.addSource('route', { type: 'geojson', data: collection() });
  map.addSource('edges', { type: 'geojson', data: collection() });
  map.addSource('issues', { type: 'geojson', data: collection() });
  map.addSource('highlight', { type: 'geojson', data: collection() });
  map.addSource('profile', { type: 'geojson', data: collection() });
  map.addSource('drag', { type: 'geojson', data: collection() });
  // Recorded use goes down first, so it reads as part of the map being planned
  // over rather than as something drawn on the route.
  map.addLayer({ id: 'use-evidence', type: 'line', source: 'use-evidence', paint: { 'line-color': '#6846a5', 'line-width': 4, 'line-opacity': 0.42 } });
  map.addLayer({ id: 'alternatives', type: 'line', source: 'alternatives', paint: { 'line-color': '#48534b', 'line-width': 5, 'line-opacity': 0.3 } });
  map.addLayer({ id: 'alternatives-hit', type: 'line', source: 'alternatives', paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': ['coalesce', ['get', 'color'], '#e85d3f'], 'line-width': 5 } });
  map.addLayer({ id: 'edges-hit', type: 'line', source: 'edges', paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({ id: 'issues', type: 'line', source: 'issues', paint: { 'line-color': ['case', ['==', ['get', 'severity'], 'high'], '#b3261e', '#d77b16'], 'line-width': 7 } });
  map.addLayer({ id: 'issues-hit', type: 'line', source: 'issues', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } });
  map.addLayer({ id: 'highlight', type: 'line', source: 'highlight', paint: { 'line-color': '#ffd24a', 'line-width': 10 } });
  map.addLayer({ id: 'drag', type: 'line', source: 'drag', paint: { 'line-color': '#b3261e', 'line-width': 3, 'line-dasharray': [1.6, 1.2] } });
  map.addLayer({ id: 'profile', type: 'circle', source: 'profile', paint: { 'circle-color': '#111', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
}

/** What the pointer says the next map click will do. Editing places a point
 * wherever the map is clicked; inspecting only reads, so it says nothing. */
function cursorFor(props: PlannerMapProps): string {
  return props.interaction === 'edit' ? 'crosshair' : '';
}

/** The web twin of the marker callout: the point's name and one way to remove it. */
function deletePopup(maplibre: MapLibreModule, name: string, onDelete: () => void) {
  const content = document.createElement('div');
  content.className = 'waypoint-popup';
  const label = document.createElement('span');
  label.textContent = name;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'waypoint-popup__remove';
  remove.setAttribute('aria-label', `Remove ${name}`);
  remove.textContent = '✕';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    onDelete();
  });
  content.append(label, remove);
  return new maplibre.Popup({ closeButton: false, offset: 18 }).setDOMContent(content);
}

function setSource(map: MapLibre.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as MapLibre.GeoJSONSource | undefined)?.setData(data);
}

function renderData(map: MapLibre.Map, props: PlannerMapProps) {
  const provisional = !props.route && props.waypoints.length > 1
    ? [line(props.waypoints.map((point) => point.coordinate))]
    : [];
  const banded = props.route
    ? props.bands.map((band) =>
        line(props.route!.geometry.slice(band.beginIndex, band.endIndex + 1), { color: band.color }),
      )
    : [];
  setSource(map, 'alternatives', collection(props.alternatives
    .filter((item) => item.result.id !== props.route?.id)
    .map((item) => line(item.result.geometry, { id: item.id }))));
  setSource(map, 'route', collection(props.route ? banded : provisional));
  setSource(map, 'edges', collection((props.route?.edges ?? []).map((edge, index) =>
    line(props.route!.geometry.slice(edge.beginIndex, edge.endIndex + 1), { index }),
  )));
  setSource(map, 'issues', collection(props.showIssues ? (props.route?.issues ?? []).map((issue: RouteIssue) => line(issue.geometry, { id: issue.id, severity: issue.severity })) : []));
  setSource(map, 'highlight', collection(props.highlightedIssue ? [line(props.highlightedIssue.geometry)] : []));
  setSource(map, 'profile', collection(props.profilePoint ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [props.profilePoint.lon, props.profilePoint.lat] } }] : []));
  setSource(map, 'use-evidence', props.evidenceSections ?? collection());
}

/** The whole kilometres along the route, each saying which one it is. Drawn as
 * elements rather than a symbol layer, so the label does not depend on the base
 * style shipping a font the planner can use. */
function renderDistanceMarks(
  maplibre: MapLibreModule,
  map: MapLibre.Map,
  markRef: React.RefObject<MapLibre.Marker[]>,
  marks: PlannerMapProps['markers'],
) {
  markRef.current.forEach((marker) => marker.remove());
  markRef.current = marks.map((mark) => {
    const element = document.createElement('span');
    element.className = 'distance-mark';
    element.textContent = String(mark.km);
    element.title = `${mark.km} km`;
    return new maplibre.Marker({ element, anchor: 'center' })
      .setLngLat([mark.coordinate.lon, mark.coordinate.lat])
      .addTo(map);
  });
}

function renderMarkers(
  maplibre: MapLibreModule,
  map: MapLibre.Map,
  markerRef: React.RefObject<MapLibre.Marker[]>,
  waypoints: Waypoint[],
  mode: PlannerMapProps['mode'],
  active: boolean,
  callbacks: React.RefObject<Callbacks>,
  editing: boolean,
) {
  markerRef.current.forEach((marker) => marker.remove());
  markerRef.current = waypoints.map((point, index) => {
    const name = waypointLabel(mode, point.role, index);
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `waypoint-marker waypoint-marker--${point.role}`;
    element.title = name;
    element.textContent = waypointMarker(point.role, index);
    const marker = new maplibre.Marker({ element, anchor: 'center', draggable: editing })
      .setLngLat([point.coordinate.lon, point.coordinate.lat])
      .addTo(map);
    // A loop's start is also its finish, and the last point standing cannot go
    // either, so neither offers to be removed.
    if (active && editing && point.role !== 'start' && waypoints.length > 2)
      marker.setPopup(deletePopup(maplibre, name, () => callbacks.current.onWaypointDelete(point.id)));
    element.addEventListener('click', (event) => {
      // The map stops here: a marker tap must not also drop a point. MapLibre
      // opens a marker's popup from the map's own click handler, so stopping
      // that propagation means toggling it here instead.
      event.stopPropagation();
      callbacks.current.onWaypointPress(point.id);
      marker.togglePopup();
    });
    marker.on('dragend', () => {
      const value = marker.getLngLat();
      callbacks.current.onWaypointMove(point.id, { lat: value.lat, lon: value.lng });
    });
    return marker;
  });
}
