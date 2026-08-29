import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { ACTIVITY } from "../domain/activity-profiles";
import type { Coordinate, PlannerState, RouteResult } from "../domain/models";
import { viewportEvidence } from "../evidence/evidence-client";

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
  viewportEvidenceSource?: string;
  showSelectedRouteEvidence: boolean;
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
  viewportEvidenceSource,
  showSelectedRouteEvidence,
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
    viewportEvidenceSource,
    showSelectedRouteEvidence,
  });
  live.current = {
    state,
    onMapClick,
    onWaypointMove,
    onCamera,
    onIssueSelect,
    onEdgeSelect,
    viewportEvidenceSource,
    showSelectedRouteEvidence,
  };

  function updateSources(
    instance: MapLibreMap,
    current: PlannerState,
    showEvidence: boolean,
  ) {
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
    const evidenceAvailable =
      current.selectedRoute?.useEvidence?.status === "available";
    set(
      "selected-evidence-route",
      showEvidence && evidenceAvailable && current.selectedRoute
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
    (instance.getSource("selected-evidence") as GeoJSONSource | undefined)?.setData(
      showEvidence && evidenceAvailable
        ? (current.selectedRoute?.useEvidence?.segments ?? collection([]))
        : collection([]),
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
      const interactiveLayers = [
        "route-edge-hit",
        "issue-lines",
        "use-evidence-hit",
        "selected-evidence-hit",
      ].filter((id) => instance.getLayer(id));
      const interactive = interactiveLayers.length
        ? instance.queryRenderedFeatures(event.point, {
            layers: interactiveLayers,
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
        "use-evidence",
        "selected-evidence-route",
        "selected-evidence",
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
        id: "use-evidence-lines",
        type: "line",
        source: "use-evidence",
        paint: {
          "line-color": "#6846a5",
          "line-width": 5,
        },
      });
      instance.addLayer({
        id: "use-evidence-hit",
        type: "line",
        source: "use-evidence",
        paint: {
          "line-color": "#000000",
          "line-width": 16,
          "line-opacity": 0.01,
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
        id: "selected-evidence-unknown",
        type: "line",
        source: "selected-evidence-route",
        paint: {
          "line-color": "#737a75",
          "line-width": 7,
          "line-dasharray": [1.5, 1.5],
        },
      });
      instance.addLayer({
        id: "selected-evidence-lines",
        type: "line",
        source: "selected-evidence",
        paint: {
          "line-color": "#15945f",
          "line-width": 7,
        },
      });
      instance.addLayer({
        id: "selected-evidence-hit",
        type: "line",
        source: "selected-evidence",
        paint: {
          "line-color": "#000000",
          "line-width": 17,
          "line-opacity": 0.01,
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
      const evidencePopup = (event: maplibregl.MapLayerMouseEvent) => {
        const properties = event.features?.[0]?.properties;
        if (!properties) return;
        const parse = (value: unknown): unknown => {
          if (typeof value !== "string") return value;
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        };
        const sources = parse(properties.sources);
        const labels = parse(properties.sourceLabels);
        const references = parse(properties.featureReferences);
        const body = document.createElement("div");
        body.className = "evidence-popup";
        const title = document.createElement("strong");
        title.textContent = properties.sectionId
          ? `Evidence section ${String(properties.sectionId)}`
          : "Route-use evidence";
        body.append(title);
        for (const text of [
          properties.wayId ? `OSM way ${String(properties.wayId)}` : undefined,
          Array.isArray(sources) ? `Sources: ${sources.join(", ")}` : undefined,
          Array.isArray(labels) ? labels.join("; ") : undefined,
          references && typeof references === "object"
            ? `Relation references: ${Object.values(references).join(", ")}`
            : undefined,
        ]) {
          if (!text) continue;
          const line = document.createElement("span");
          line.textContent = text;
          body.append(line);
        }
        const disclaimer = document.createElement("small");
        disclaimer.textContent =
          "No route-use evidence means unknown, not unused, unsafe or unsuitable.";
        body.append(disclaimer);
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(event.lngLat)
          .setDOMContent(body)
          .addTo(instance);
      };
      instance.on("click", "use-evidence-hit", evidencePopup);
      instance.on("click", "selected-evidence-hit", evidencePopup);
      for (const layer of ["use-evidence-hit", "selected-evidence-hit"]) {
        instance.on("mouseenter", layer, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", layer, () => {
          instance.getCanvas().style.cursor = "";
        });
      }
      updateSources(
        instance,
        live.current.state,
        live.current.showSelectedRouteEvidence,
      );
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
    if (instance?.isStyleLoaded())
      updateSources(instance, state, showSelectedRouteEvidence);
  }, [state, showSelectedRouteEvidence]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    let timer: number | undefined;
    let abort: AbortController | undefined;
    const clear = () =>
      (instance.getSource("use-evidence") as GeoJSONSource | undefined)?.setData(
        collection([]),
      );
    const load = () => {
      window.clearTimeout(timer);
      abort?.abort();
      if (!viewportEvidenceSource || !instance.isStyleLoaded()) {
        clear();
        return;
      }
      timer = window.setTimeout(() => {
        const bounds = instance.getBounds();
        abort = new AbortController();
        void viewportEvidence(
          [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          viewportEvidenceSource === "any" ? undefined : viewportEvidenceSource,
          abort.signal,
        )
          .then((data) =>
            (instance.getSource("use-evidence") as GeoJSONSource | undefined)?.setData(data),
          )
          .catch((error) => {
            if ((error as Error).name !== "AbortError") clear();
          });
      }, 300);
    };
    instance.on("moveend", load);
    load();
    return () => {
      window.clearTimeout(timer);
      abort?.abort();
      instance.off("moveend", load);
    };
  }, [viewportEvidenceSource]);

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
