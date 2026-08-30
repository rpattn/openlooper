import { useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';

import type { PlannerMapProps } from './planner-map.types';

type MapLibreModule = typeof import('maplibre-gl');
type PlannerCallbacks = Pick<PlannerMapProps, 'onMapPress' | 'onWaypointPress'>;
const MAPLIBRE_WORKER_URL =
  'https://unpkg.com/maplibre-gl@6.6.0/dist/maplibre-gl-worker.mjs';

const emptyLine = (): GeoJSON.FeatureCollection<GeoJSON.LineString> => ({
  type: 'FeatureCollection',
  features: [],
});

const waypointLine = (
  waypoints: PlannerMapProps['waypoints'],
): GeoJSON.FeatureCollection<GeoJSON.LineString> => ({
  type: 'FeatureCollection',
  features:
    waypoints.length > 1
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: waypoints.map(({ coordinate }) => [coordinate.lon, coordinate.lat]),
            },
          },
        ]
      : [],
});

export function PlannerMap({ camera, waypoints, onMapPress, onWaypointPress }: PlannerMapProps) {
  const [mapError, setMapError] = useState<string>();
  const [mapReady, setMapReady] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const markers = useRef<MapLibre.Marker[]>([]);
  const callbacks = useRef<PlannerCallbacks>({ onMapPress, onWaypointPress });
  const cameraSnapshot = useRef(camera.center);
  const waypointSnapshot = useRef(waypoints);
  callbacks.current = { onMapPress, onWaypointPress };
  cameraSnapshot.current = camera.center;
  waypointSnapshot.current = waypoints;

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;

    void import('maplibre-gl')
      .then((module) => {
        const element = container.current;
        if (cancelled || !element) return;

        module.setWorkerUrl(MAPLIBRE_WORKER_URL);

        const instance = new module.Map({
          container: element,
          style: 'https://tiles.openfreemap.org/styles/liberty',
          center: [cameraSnapshot.current.lon, cameraSnapshot.current.lat],
          zoom: 13,
          attributionControl: false,
        });
        map.current = instance;
        instance.addControl(new module.AttributionControl({ compact: true }), 'bottom-right');
        instance.addControl(new module.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('click', (event) =>
          callbacks.current.onMapPress({ lat: event.lngLat.lat, lon: event.lngLat.lng }),
        );
        instance.on('error', (event) => {
          if (!instance.isStyleLoaded()) setMapError(event.error.message);
        });
        instance.on('load', () => {
          setMapReady(true);
          instance.addSource('provisional', { type: 'geojson', data: emptyLine() });
          instance.addLayer({
            id: 'provisional-line',
            type: 'line',
            source: 'provisional',
            paint: {
              'line-color': '#273f78',
              'line-width': 3,
              'line-dasharray': [2, 2],
              'line-opacity': 0.8,
            },
          });
          updateLine(instance, waypointSnapshot.current);
        });
        renderMarkers(module, instance, markers, waypointSnapshot.current, callbacks);
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(element);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMapError(error instanceof Error ? error.message : 'Map failed to start.');
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.setCenter([camera.center.lon, camera.center.lat]);
  }, [camera.center.lat, camera.center.lon]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    void import('maplibre-gl').then((module) => {
      if (map.current !== instance) return;
      renderMarkers(module, instance, markers, waypoints, callbacks);
      updateLine(instance, waypoints);
    });
  }, [waypoints]);

  return (
    <div className="planner-map-shell">
      <div ref={container} className="planner-map" aria-label="Route planning map" />
      {!mapReady && (
        <div className={`map-status${mapError ? ' map-status--error' : ''}`} role="status">
          {mapError ? `Map unavailable: ${mapError}` : 'Loading map…'}
        </div>
      )}
    </div>
  );
}

function updateLine(instance: MapLibre.Map, waypoints: PlannerMapProps['waypoints']) {
  (instance.getSource('provisional') as MapLibre.GeoJSONSource | undefined)?.setData(
    waypointLine(waypoints),
  );
}

function renderMarkers(
  maplibre: MapLibreModule,
  instance: MapLibre.Map,
  markerRef: React.RefObject<MapLibre.Marker[]>,
  waypoints: PlannerMapProps['waypoints'],
  callbacks: React.RefObject<PlannerCallbacks>,
) {
  markerRef.current.forEach((marker) => marker.remove());
  markerRef.current = waypoints.map((point, index) => {
    const marker = document.createElement('button');
    const label =
      point.role === 'start' ? 'A' : point.role === 'destination' ? 'B' : String(index + 1);
    marker.type = 'button';
    marker.className = `waypoint-marker waypoint-marker--${point.role}`;
    marker.textContent = label;
    marker.setAttribute('aria-label', `${point.role} point ${index + 1}`);
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      callbacks.current.onWaypointPress(point.id);
    });
    return new maplibre.Marker({ element: marker, anchor: 'center' })
      .setLngLat([point.coordinate.lon, point.coordinate.lat])
      .addTo(instance);
  });
}
