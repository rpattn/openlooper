import { cumulativeDistances } from "./geometry";
import type { EdgeAttributes, RouteOverlay, RouteResult } from "./models";

export type OverlayBand = {
  beginIndex: number;
  endIndex: number;
  color: string;
};
export type LegendEntry = { color: string; label: string };
/** A coloured band expressed along the route's distance axis. */
export type ColourSpan = { startKm: number; endKm: number; color: string };
export type OverlayRender = {
  bands: OverlayBand[];
  legend: LegendEntry[];
  /** Set when the colouring cannot be drawn from what the route carries. */
  unavailable?: string;
};

export const OVERLAY_LABEL: Record<RouteOverlay, string> = {
  route: "Plain route",
  gradient: "Gradient",
  surface: "Surface",
  roads: "Road type",
  usage: "Recorded use",
  speed: "Predicted speed",
};

const UNKNOWN = "#98a29a";
// Valhalla reports 32768 for an edge whose grade it does not know.
const GRADE_UNAVAILABLE = 32000;

type Bucket = { color: string; label: string; test: (edge: EdgeAttributes) => boolean };

function grade(edge: EdgeAttributes): number | undefined {
  const value = Math.max(
    Math.abs(edge.maxUpwardGrade ?? 0),
    Math.abs(edge.maxDownwardGrade ?? 0),
  );
  return value >= GRADE_UNAVAILABLE ? undefined : value;
}

const GRADIENT: Bucket[] = [
  { color: "#2e9e6b", label: "Under 3%", test: (e) => (grade(e) ?? -1) < 3 },
  { color: "#9bc53d", label: "3–6%", test: (e) => (grade(e) ?? -1) < 6 },
  { color: "#efa00b", label: "6–9%", test: (e) => (grade(e) ?? -1) < 9 },
  { color: "#e2601b", label: "9–13%", test: (e) => (grade(e) ?? -1) < 13 },
  { color: "#b3261e", label: "13% and above", test: (e) => grade(e) !== undefined },
];

const SURFACE: Bucket[] = [
  {
    color: "#3166c7",
    label: "Paved",
    test: (e) =>
      e.unpaved === false ||
      ["paved", "asphalt", "concrete", "paving_stones"].includes(
        (e.surface ?? "").toLowerCase(),
      ),
  },
  {
    color: "#b06a1f",
    label: "Compacted or gravel",
    test: (e) =>
      ["compacted", "gravel", "fine_gravel", "dirt", "ground", "grass"].includes(
        (e.surface ?? "").toLowerCase(),
      ),
  },
  {
    color: "#8a3b12",
    label: "Rough or impassable",
    test: (e) =>
      e.unpaved === true ||
      ["path", "sand", "mud", "impassable"].includes((e.surface ?? "").toLowerCase()),
  },
];

const ROADS: Bucket[] = [
  {
    color: "#2e9e6b",
    label: "Path, footway or cycleway",
    test: (e) =>
      ["footway", "cycleway", "path", "pedestrian", "track", "steps", "living_street"].some(
        (value) => (e.use ?? "").toLowerCase().includes(value),
      ) || ["footway", "cycleway", "path", "pedestrian"].includes((e.roadClass ?? "").toLowerCase()),
  },
  {
    color: "#6b8ba4",
    label: "Residential or service",
    test: (e) =>
      ["residential", "service_other", "unclassified", "living_street"].includes(
        (e.roadClass ?? "").toLowerCase(),
      ),
  },
  {
    color: "#efa00b",
    label: "Secondary or tertiary",
    test: (e) => ["secondary", "tertiary"].includes((e.roadClass ?? "").toLowerCase()),
  },
  {
    color: "#b3261e",
    label: "Primary, trunk or motorway",
    test: (e) =>
      ["primary", "trunk", "motorway"].includes((e.roadClass ?? "").toLowerCase()),
  },
];

function speedBuckets(): Bucket[] {
  const at = (edge: EdgeAttributes) => edge.speedKph;
  return [
    { color: "#b3261e", label: "Under 8 km/h", test: (e) => (at(e) ?? -1) >= 0 && at(e)! < 8 },
    { color: "#efa00b", label: "8–16 km/h", test: (e) => (at(e) ?? -1) < 16 && at(e) !== undefined },
    { color: "#9bc53d", label: "16–25 km/h", test: (e) => (at(e) ?? -1) < 25 && at(e) !== undefined },
    { color: "#2e9e6b", label: "25 km/h and above", test: (e) => at(e) !== undefined },
  ];
}

function bucketed(route: RouteResult, buckets: Bucket[], unknownLabel: string): OverlayRender {
  const used = new Set<string>();
  const bands = route.edges.map((edge) => {
    const bucket = buckets.find((candidate) => candidate.test(edge.attributes));
    used.add(bucket?.label ?? unknownLabel);
    return {
      beginIndex: edge.beginIndex,
      endIndex: edge.endIndex,
      color: bucket?.color ?? UNKNOWN,
    };
  });
  const legend = [
    ...buckets.map(({ color, label }) => ({ color, label })),
    { color: UNKNOWN, label: unknownLabel },
  ].filter((entry) => used.has(entry.label));
  return { bands, legend };
}

/** Way ids the evidence service reported at least one recorded use for. */
function evidencedWays(route: RouteResult): Set<number> {
  const ways = new Set<number>();
  for (const feature of route.useEvidence?.segments?.features ?? []) {
    const wayId = Number(feature.properties?.wayId);
    if (Number.isFinite(wayId)) ways.add(wayId);
  }
  return ways;
}

/**
 * Turns the selected route into coloured bands plus the legend that explains
 * them. Every colouring is derived from what the route already carries, so an
 * overlay never triggers another request.
 */
export function overlayRender(
  route: RouteResult,
  overlay: RouteOverlay,
  accent: string,
): OverlayRender {
  if (overlay === "route")
    return {
      bands: [{ beginIndex: 0, endIndex: route.geometry.length - 1, color: accent }],
      legend: [],
    };
  if (!route.edges.length)
    return {
      bands: [{ beginIndex: 0, endIndex: route.geometry.length - 1, color: accent }],
      legend: [],
      unavailable:
        "Route attribution is unavailable, so this colouring cannot be drawn.",
    };
  if (overlay === "gradient") return bucketed(route, GRADIENT, "Gradient not recorded");
  if (overlay === "surface") return bucketed(route, SURFACE, "Surface not recorded");
  if (overlay === "roads") return bucketed(route, ROADS, "Road type not recorded");
  if (overlay === "speed") {
    const render = bucketed(route, speedBuckets(), "Speed not recorded");
    return route.edges.some((edge) => edge.attributes.speedKph !== undefined)
      ? render
      : {
          ...render,
          unavailable: "The routing service returned no predicted speeds for this route.",
        };
  }
  if (route.useEvidence?.status !== "available" || !route.useEvidence.segments)
    return {
      bands: [{ beginIndex: 0, endIndex: route.geometry.length - 1, color: UNKNOWN }],
      legend: [],
      unavailable: "Route-use evidence is unavailable for this route.",
    };
  const ways = evidencedWays(route);
  return {
    bands: route.edges.map((edge) => ({
      beginIndex: edge.beginIndex,
      endIndex: edge.endIndex,
      color:
        edge.attributes.wayId !== undefined && ways.has(edge.attributes.wayId)
          ? "#2e9e6b"
          : UNKNOWN,
    })),
    legend: [
      { color: "#2e9e6b", label: "Recorded use" },
      { color: UNKNOWN, label: "No recorded use" },
    ],
  };
}

/**
 * Re-expresses the map's coloured bands against distance travelled, so the same
 * colouring can be drawn under the profile chart.
 */
export function overlaySpans(
  route: RouteResult,
  bands: OverlayBand[],
): ColourSpan[] {
  const cumulative = cumulativeDistances(route.geometry);
  const total = cumulative.at(-1) ?? 0;
  if (!total) return [];
  return bands.map((band) => ({
    startKm: cumulative[band.beginIndex] ?? 0,
    endKm: cumulative[band.endIndex] ?? total,
    color: band.color,
  }));
}
