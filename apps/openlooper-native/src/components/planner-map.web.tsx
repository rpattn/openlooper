import { useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';

import { ACTIVITY, type Coordinate, type RouteIssue, type Waypoint } from '@/domain/models';
import type { PlannerMapProps } from './planner-map.types';

type MapLibreModule = typeof import('maplibre-gl');
type Callbacks = Pick<
  PlannerMapProps,
  'onMapPress' | 'onWaypointPress' | 'onWaypointMove' | 'onIssuePress' | 'onEdgePress' | 'onAlternativePress' | 'onCameraChange'
>;
const WORKER_URL = 'https://unpkg.com/maplibre-gl@6.6.0/dist/maplibre-gl-worker.mjs';
const collection = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});
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
  const markers = useRef<MapLibre.Marker[]>([]);
  const emittedCenter = useRef<Coordinate | undefined>(undefined);
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
          style: 'https://tiles.openfreemap.org/styles/liberty',
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
          if (!interactive.length || snapshot.current.activeTool === 'add')
            callbacks.current.onMapPress({ lat: event.lngLat.lat, lon: event.lngLat.lng });
        });
        instance.on('moveend', () => {
          const center = instance.getCenter();
          emittedCenter.current = { lat: center.lat, lon: center.lng };
          callbacks.current.onCameraChange({ lat: center.lat, lon: center.lng }, instance.getZoom());
        });
        instance.on('error', (event) => {
          if (!instance.isStyleLoaded()) setError(event.error.message);
        });
        instance.on('load', () => {
          addLayers(instance);
          setReady(true);
          renderData(instance, snapshot.current);
          renderMarkers(module, instance, markers, snapshot.current.waypoints, callbacks);
          instance.on('click', 'issues-hit', (event) => {
            if (snapshot.current.activeTool === 'add') return;
            const id = event.features?.[0]?.properties?.id as string | undefined;
            if (id) callbacks.current.onIssuePress(id);
          });
          instance.on('click', 'edges-hit', (event) => {
            if (snapshot.current.activeTool === 'add') return;
            const index = Number(event.features?.[0]?.properties?.index);
            if (Number.isFinite(index)) callbacks.current.onEdgePress(index);
          });
          instance.on('click', 'alternatives-hit', (event) => {
            if (snapshot.current.activeTool === 'add') return;
            const id = event.features?.[0]?.properties?.id as string | undefined;
            if (id) callbacks.current.onAlternativePress(id);
          });
        });
        renderMarkers(module, instance, markers, snapshot.current.waypoints, callbacks);
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
      if (map.current === instance) renderMarkers(module, instance, markers, props.waypoints, callbacks);
    });
  }, [props, ready]);

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
    instance.fitBounds([[west, south], [east, north]], { padding: 70, maxZoom: 16 });
  }, [props.fitRequest, props.route?.geometry, props.route?.id]);

  useEffect(() => {
    const instance = map.current;
    const coordinates = props.highlightedIssue?.geometry;
    if (!instance || !coordinates?.length) return;
    const west = Math.min(...coordinates.map((point) => point.lon));
    const east = Math.max(...coordinates.map((point) => point.lon));
    const south = Math.min(...coordinates.map((point) => point.lat));
    const north = Math.max(...coordinates.map((point) => point.lat));
    instance.fitBounds([[west, south], [east, north]], { padding: 90, maxZoom: 17 });
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
  map.addSource('alternatives', { type: 'geojson', data: collection() });
  map.addSource('route', { type: 'geojson', data: collection() });
  map.addSource('edges', { type: 'geojson', data: collection() });
  map.addSource('issues', { type: 'geojson', data: collection() });
  map.addSource('highlight', { type: 'geojson', data: collection() });
  map.addSource('profile', { type: 'geojson', data: collection() });
  map.addLayer({ id: 'alternatives', type: 'line', source: 'alternatives', paint: { 'line-color': '#48534b', 'line-width': 5, 'line-opacity': 0.3 } });
  map.addLayer({ id: 'alternatives-hit', type: 'line', source: 'alternatives', paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 9, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#e85d3f', 'line-width': 5 } });
  map.addLayer({ id: 'edges-hit', type: 'line', source: 'edges', paint: { 'line-color': '#000', 'line-width': 16, 'line-opacity': 0 } });
  map.addLayer({ id: 'issues', type: 'line', source: 'issues', paint: { 'line-color': ['case', ['==', ['get', 'severity'], 'high'], '#b3261e', '#d77b16'], 'line-width': 7 } });
  map.addLayer({ id: 'issues-hit', type: 'line', source: 'issues', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } });
  map.addLayer({ id: 'highlight', type: 'line', source: 'highlight', paint: { 'line-color': '#ffd24a', 'line-width': 10 } });
  map.addLayer({ id: 'profile', type: 'circle', source: 'profile', paint: { 'circle-color': '#111', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
}

function setSource(map: MapLibre.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as MapLibre.GeoJSONSource | undefined)?.setData(data);
}

function renderData(map: MapLibre.Map, props: PlannerMapProps) {
  const provisional = !props.route && props.waypoints.length > 1
    ? [line(props.waypoints.map((point) => point.coordinate))]
    : [];
  setSource(map, 'alternatives', collection(props.alternatives
    .filter((item) => item.result.id !== props.route?.id)
    .map((item) => line(item.result.geometry, { id: item.id }))));
  setSource(map, 'route', collection(props.route ? [line(props.route.geometry)] : provisional));
  map.setPaintProperty('route-line', 'line-color', ACTIVITY[props.activity].color);
  setSource(map, 'edges', collection((props.route?.edges ?? []).map((edge, index) =>
    line(props.route!.geometry.slice(edge.beginIndex, edge.endIndex + 1), { index }),
  )));
  setSource(map, 'issues', collection((props.route?.issues ?? []).map((issue: RouteIssue) => line(issue.geometry, { id: issue.id, severity: issue.severity }))));
  setSource(map, 'highlight', collection(props.highlightedIssue ? [line(props.highlightedIssue.geometry)] : []));
  setSource(map, 'profile', collection(props.profilePoint ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [props.profilePoint.lon, props.profilePoint.lat] } }] : []));
}

function renderMarkers(
  maplibre: MapLibreModule,
  map: MapLibre.Map,
  markerRef: React.RefObject<MapLibre.Marker[]>,
  waypoints: Waypoint[],
  callbacks: React.RefObject<Callbacks>,
) {
  markerRef.current.forEach((marker) => marker.remove());
  markerRef.current = waypoints.map((point, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `waypoint-marker waypoint-marker--${point.role}`;
    element.textContent = point.role === 'start' ? 'A' : point.role === 'destination' ? 'B' : String(index + 1);
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.current.onWaypointPress(point.id);
    });
    const marker = new maplibre.Marker({ element, anchor: 'center', draggable: true })
      .setLngLat([point.coordinate.lon, point.coordinate.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const value = marker.getLngLat();
      callbacks.current.onWaypointMove(point.id, { lat: value.lat, lon: value.lng });
    });
    return marker;
  });
}
