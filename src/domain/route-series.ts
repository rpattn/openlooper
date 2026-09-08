import { cumulativeDistances } from "./geometry";
import type { Coordinate, RouteOverlay, RouteResult } from "./models";
import {
  elevationUnit,
  speedUnit,
  toElevation,
  toSpeed,
  type UnitSystem,
} from "./units";

export type SeriesPoint = {
  distanceKm: number;
  value: number;
  coordinate: Coordinate;
};
/** What the values are, which is what says how to convert them. */
export type SeriesKind = "elevation" | "gradient" | "speed";
export type RouteSeries = {
  points: SeriesPoint[];
  label: string;
  unit: string;
  /** Decimal places for readouts and axis labels. */
  precision: number;
  kind: SeriesKind;
};

const EMPTY: RouteSeries = {
  points: [],
  label: "Elevation",
  unit: " m",
  precision: 0,
  kind: "elevation",
};

function elevationSeries(route: RouteResult): RouteSeries {
  return {
    points: route.elevation.map((point) => ({
      distanceKm: point.distanceKm,
      value: point.elevationM,
      coordinate: point.coordinate,
    })),
    label: "Elevation",
    unit: " m",
    precision: 0,
    kind: "elevation",
  };
}

/**
 * Rise over run along the elevation profile, smoothed across a short window so
 * the 30 m sampling interval does not turn every step into a spike.
 */
function gradientSeries(route: RouteResult): RouteSeries {
  const points = route.elevation;
  const window = 2;
  return {
    points: points.map((point, index) => {
      const from = points[Math.max(0, index - window)]!;
      const to = points[Math.min(points.length - 1, index + window)]!;
      const runM = (to.distanceKm - from.distanceKm) * 1000;
      return {
        distanceKm: point.distanceKm,
        value: runM > 1 ? ((to.elevationM - from.elevationM) / runM) * 100 : 0,
        coordinate: point.coordinate,
      };
    }),
    label: "Gradient",
    unit: "%",
    precision: 1,
    kind: "gradient",
  };
}

/** Valhalla's predicted speed, held flat across each edge it applies to. */
function speedSeries(route: RouteResult): RouteSeries | undefined {
  if (!route.edges.some((edge) => edge.attributes.speedKph !== undefined)) return undefined;
  const cumulative = cumulativeDistances(route.geometry);
  const points: SeriesPoint[] = [];
  for (const edge of route.edges) {
    const speed = edge.attributes.speedKph;
    if (speed === undefined) continue;
    for (const index of [edge.beginIndex, edge.endIndex]) {
      const coordinate = route.geometry[index];
      if (!coordinate) continue;
      points.push({ distanceKm: cumulative[index] ?? 0, value: speed, coordinate });
    }
  }
  return points.length
    ? { points, label: "Predicted speed", unit: " km/h", precision: 0, kind: "speed" }
    : undefined;
}

/**
 * The series the profile chart plots for a colouring. Colourings without a
 * value of their own keep showing elevation, which stays the useful shape to
 * read the route's colours against.
 */
export function routeSeries(
  route: RouteResult | undefined,
  overlay: RouteOverlay,
): RouteSeries {
  if (!route?.elevation.length && overlay !== "speed") return EMPTY;
  if (!route) return EMPTY;
  if (overlay === "gradient" && route.elevation.length > 2) return gradientSeries(route);
  if (overlay === "speed") return speedSeries(route) ?? elevationSeries(route);
  return elevationSeries(route);
}

/**
 * The same series read in the planner's chosen units. Gradients are a ratio and
 * so are the same everywhere; only the two measured series convert.
 */
export function convertSeries(series: RouteSeries, units: UnitSystem): RouteSeries {
  if (units === "metric" || series.kind === "gradient") return series;
  const convert = series.kind === "elevation" ? toElevation : toSpeed;
  return {
    ...series,
    points: series.points.map((point) => ({ ...point, value: convert(point.value, units) })),
    unit: series.kind === "elevation" ? ` ${elevationUnit(units)}` : ` ${speedUnit(units)}`,
  };
}
