import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { ACTIVITY } from "../domain/activity-profiles";
import type { Coordinate, PlannerState, RouteResult } from "../domain/models";

type MapApi = {
  fit: (route?: RouteResult) => void;
  fly: (coordinate: Coordinate, zoom?: number) => void;
};
type Props = {
  state: PlannerState;
  onMapClick: (coordinate: Coordinate) => void;
  onWaypointMove: (
    id: string,
    coordinate: Coordinate,
    finished: boolean,
  ) => void;
  onCamera: (center: Coordinate, zoom: number) => void;
  onIssueSelect: (id: string) => void;
  onEdgeSelect: (index: number) => void;
  mapApiRef: React.MutableRefObject<MapApi | null>;
};
const collection = (features: GeoJSON.Feature[]) =>
  ({ type: "FeatureCollection", features }) as GeoJSON.FeatureCollection;
const coordinates = (points: Coordinate[]) =>
  points.map((point) => [point.lon, point.lat]);
maplibregl.setWorkerUrl(workerUrl);

export function RouteMap({
  state,
  onMapClick,
  onWaypointMove,
  onCamera,
  onIssueSelect,
  onEdgeSelect,
  mapApiRef,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | undefined>(undefined);
  const markers = useRef<Marker[]>([]);
  const live = useRef({
    state,
    onMapClick,
    onWaypointMove,
    onCamera,
    onIssueSelect,
    onEdgeSelect,
  });
  live.current = {
    state,
    onMapClick,
    onWaypointMove,
    onCamera,
    onIssueSelect,
    onEdgeSelect,
  };

  function updateSources(instance: MapLibreMap, current: PlannerState) {
    const set = (id: string, features: GeoJSON.Feature[]) =>
      (instance.getSource(id) as GeoJSONSource | undefined)?.setData(
        collection(features),
      );
    set(
      "selected",
      current.selectedRoute
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: coordinates(current.selectedRoute.geometry),
              },
            },
          ]
        : [],
    );
    set(
      "alternatives",
      current.alternatives
        .filter((item) => item.result.id !== current.selectedRoute?.id)
        .map((item) => ({
          type: "Feature",
          properties: { id: item.id },
          geometry: {
            type: "LineString",
            coordinates: coordinates(item.result.geometry),
          },
        })),
    );
    set(
      "route-edges",
      (current.selectedRoute?.edges ?? []).map((edge, index) => ({
        type: "Feature",
        properties: { index },
        geometry: {
          type: "LineString",
          coordinates: coordinates(
            current.selectedRoute!.geometry.slice(
              edge.beginIndex,
              edge.endIndex + 1,
            ),
          ),
        },
      })),
    );
    set(
      "issues",
      (current.selectedRoute?.issues ?? []).map((issue) => ({
        type: "Feature",
        properties: { id: issue.id, severity: issue.severity },
        geometry: {
          type: "LineString",
          coordinates: coordinates(issue.geometry),
        },
      })),
    );
    const highlighted = current.selectedRoute?.issues.find(
      (issue) => issue.id === current.highlightedIssueId,
    );
    const highlightedEdge =
      current.highlightedEdgeIndex === undefined
        ? undefined
        : current.selectedRoute?.edges[current.highlightedEdgeIndex];
    const highlightedGeometry = highlighted
      ? highlighted.geometry
      : highlightedEdge && current.selectedRoute
        ? current.selectedRoute.geometry.slice(
            highlightedEdge.beginIndex,
            highlightedEdge.endIndex + 1,
          )
        : undefined;
    set(
      "highlight",
      highlightedGeometry
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: coordinates(highlightedGeometry),
              },
            },
          ]
        : [],
    );
    set(
      "cursor",
      current.profilePoint
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Point",
                coordinates: [
                  current.profilePoint.lon,
                  current.profilePoint.lat,
                ],
              },
            },
          ]
        : [],
    );
    if (instance.getLayer("selected-line"))
      instance.setPaintProperty(
        "selected-line",
        "line-color",
        ACTIVITY[current.plan.activity].color,
      );
    if (instance.getLayer("cursor-point"))
      instance.setPaintProperty(
        "cursor-point",
        "circle-stroke-color",
        ACTIVITY[current.plan.activity].color,
      );
  }

  useEffect(() => {
    if (!container.current || map.current) return;
    const initial = live.current.state;
    const instance = new maplibregl.Map({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [initial.camera.center.lon, initial.camera.center.lat],
      zoom: initial.camera.zoom,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.on("click", (event) => {
      const interactive = instance.getLayer("route-edge-hit")
        ? instance.queryRenderedFeatures(event.point, {
            layers: ["route-edge-hit", "issue-lines"],
          })
        : [];
      if (!interactive.length || live.current.state.activeTool === "add")
        live.current.onMapClick({
          lat: event.lngLat.lat,
          lon: event.lngLat.lng,
        });
    });
    instance.on("moveend", () => {
      const center = instance.getCenter();
      live.current.onCamera(
        { lat: center.lat, lon: center.lng },
        instance.getZoom(),
      );
    });
    instance.on("load", () => {
      for (const id of [
        "alternatives",
        "selected",
        "route-edges",
        "provisional",
        "issues",
        "highlight",
        "cursor",
      ])
        instance.addSource(id, { type: "geojson", data: collection([]) });
      instance.addLayer({
        id: "alternative-lines",
        type: "line",
        source: "alternatives",
        paint: {
          "line-color": "#66736b",
          "line-width": 4,
          "line-opacity": 0.38,
        },
      });
      instance.addLayer({
        id: "selected-casing",
        type: "line",
        source: "selected",
        paint: {
          "line-color": "#ffffff",
          "line-width": 9,
          "line-opacity": 0.92,
        },
      });
      instance.addLayer({
        id: "selected-line",
        type: "line",
        source: "selected",
        paint: {
          "line-color": ACTIVITY[live.current.state.plan.activity].color,
          "line-width": 6,
        },
      });
      instance.addLayer({
        id: "route-edge-hit",
        type: "line",
        source: "route-edges",
        paint: {
          "line-color": "#000000",
          "line-width": 18,
          "line-opacity": 0.01,
        },
      });
      instance.addLayer({
        id: "provisional-line",
        type: "line",
        source: "provisional",
        paint: {
          "line-color": "#273f78",
          "line-width": 3,
          "line-dasharray": [2, 2],
          "line-opacity": 0.8,
        },
      });
      instance.addLayer({
        id: "issue-lines",
        type: "line",
        source: "issues",
        paint: {
          "line-color": [
            "match",
            ["get", "severity"],
            "high",
            "#9e2636",
            "warning",
            "#e09c25",
            "#626b66",
          ],
          "line-width": 5,
          "line-opacity": 0.85,
        },
      });
      instance.addLayer({
        id: "highlight-line",
        type: "line",
        source: "highlight",
        paint: {
          "line-color": "#171d19",
          "line-width": 9,
          "line-opacity": 0.9,
        },
      });
      instance.addLayer({
        id: "cursor-point",
        type: "circle",
        source: "cursor",
        paint: {
          "circle-radius": 7,
          "circle-color": "#fff",
          "circle-stroke-width": 4,
          "circle-stroke-color":
            ACTIVITY[live.current.state.plan.activity].color,
        },
      });
      instance.on("click", "issue-lines", (event) => {
        if (live.current.state.activeTool === "add") return;
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") live.current.onIssueSelect(id);
      });
      instance.on("click", "route-edge-hit", (event) => {
        if (live.current.state.activeTool === "add") return;
        if (
          instance.queryRenderedFeatures(event.point, {
            layers: ["issue-lines"],
          }).length
        )
          return;
        const index = Number(event.features?.[0]?.properties?.index);
        if (Number.isInteger(index)) live.current.onEdgeSelect(index);
      });
      instance.on("mousemove", "route-edge-hit", (event) => {
        if (live.current.state.activeTool === "add") return;
        if (
          instance.queryRenderedFeatures(event.point, {
            layers: ["issue-lines"],
          }).length
        )
          return;
        const index = Number(event.features?.[0]?.properties?.index);
        if (
          Number.isInteger(index) &&
          live.current.state.highlightedEdgeIndex !== index
        )
          live.current.onEdgeSelect(index);
      });
      instance.on("mouseenter", "route-edge-hit", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "route-edge-hit", () => {
        instance.getCanvas().style.cursor = "";
      });
      instance.on("mouseenter", "issue-lines", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "issue-lines", () => {
        instance.getCanvas().style.cursor = "";
      });
      updateSources(instance, live.current.state);
    });
    mapApiRef.current = {
      fit: (route) => {
        if (route) {
          const [southwest, northeast] = route.bounds;
          instance.fitBounds(
            [
              [southwest.lon, southwest.lat],
              [northeast.lon, northeast.lat],
            ],
            {
              padding: {
                top: 100,
                right: 40,
                bottom: 260,
                left: window.innerWidth > 720 ? 420 : 40,
              },
              maxZoom: 16,
              duration: 600,
            },
          );
        }
      },
      fly: (point, zoom = 15) =>
        instance.flyTo({ center: [point.lon, point.lat], zoom }),
    };
    return () => {
      mapApiRef.current = null;
      instance.remove();
      map.current = undefined;
    };
  }, [mapApiRef]);

  useEffect(() => {
    const instance = map.current;
    if (instance?.isStyleLoaded()) updateSources(instance, state);
  }, [state]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = state.plan.waypoints.map((point, index) => {
      const element = document.createElement("button");
      element.className = `waypoint-marker waypoint-marker--${point.role}`;
      element.type = "button";
      const loopReturn =
        state.plan.mode === "loop" && point.role === "destination";
      element.setAttribute(
        "aria-label",
        `${loopReturn ? "return to start" : point.role} point ${index + 1}`,
      );
      element.textContent =
        point.role === "start"
          ? "A"
          : point.role === "destination"
            ? loopReturn
              ? "A"
              : "B"
            : String(index + 1);
      const marker = new maplibregl.Marker({ element, draggable: true })
        .setLngLat([point.coordinate.lon, point.coordinate.lat])
        .addTo(instance);
      marker.on("drag", () => {
        const position = marker.getLngLat();
        const provisional = live.current.state.plan.waypoints.map((item) =>
          item.id === point.id
            ? { lat: position.lat, lon: position.lng }
            : item.coordinate,
        );
        (instance.getSource("provisional") as GeoJSONSource)?.setData(
          collection([
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: coordinates(provisional),
              },
            },
          ]),
        );
        live.current.onWaypointMove(
          point.id,
          { lat: position.lat, lon: position.lng },
          false,
        );
      });
      marker.on("dragend", () => {
        const position = marker.getLngLat();
        (instance.getSource("provisional") as GeoJSONSource)?.setData(
          collection([]),
        );
        live.current.onWaypointMove(
          point.id,
          { lat: position.lat, lon: position.lng },
          true,
        );
      });
      return marker;
    });
  }, [state.plan.mode, state.plan.waypoints]);

  return (
    <div ref={container} className="map" aria-label="Route planning map" />
  );
}
