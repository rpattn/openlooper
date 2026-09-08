/**
 * How measurements are shown. Everything the planner computes is metric — the
 * routing service, the elevation data and the stored routes all are — so this
 * converts only at the point of being read, and never on the way in.
 */
export type UnitSystem = "metric" | "imperial";

export const UNIT_SYSTEMS: readonly { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
];

const KM_PER_MILE = 1.609344;
const FEET_PER_METRE = 3.280839895;
const YARDS_PER_METRE = 1.0936133;
/** Below this a long distance reads better in the small unit. */
const SHORT_KM = 1;

export function isImperial(units: UnitSystem): boolean {
  return units === "imperial";
}

/** What a long distance is counted in: kilometres, or miles. */
export function distanceUnit(units: UnitSystem): string {
  return isImperial(units) ? "mi" : "km";
}

/** What a short distance is counted in: metres, or yards. */
export function shortDistanceUnit(units: UnitSystem): string {
  return isImperial(units) ? "yd" : "m";
}

export function elevationUnit(units: UnitSystem): string {
  return isImperial(units) ? "ft" : "m";
}

export function speedUnit(units: UnitSystem): string {
  return isImperial(units) ? "mph" : "km/h";
}

/** A distance in kilometres, as a number in the chosen unit. */
export function toDistance(km: number, units: UnitSystem): number {
  return isImperial(units) ? km / KM_PER_MILE : km;
}

/** The inverse, for anything the planner types in and the planner stores in km. */
export function fromDistance(value: number, units: UnitSystem): number {
  return isImperial(units) ? value * KM_PER_MILE : value;
}

export function toElevation(metres: number, units: UnitSystem): number {
  return isImperial(units) ? metres * FEET_PER_METRE : metres;
}

export function toSpeed(kph: number, units: UnitSystem): number {
  return isImperial(units) ? kph / KM_PER_MILE : kph;
}

/** A route-length distance, with its unit. */
export function formatDistance(km: number, units: UnitSystem, digits = 1): string {
  return `${toDistance(km, units).toFixed(digits)} ${distanceUnit(units)}`;
}

/**
 * A distance that may be short enough to want the smaller unit — a leg between
 * two points, or one segment of road. Reading "0.1 km" for a street corner is
 * worse than reading "90 m".
 */
export function formatShortDistance(km: number, units: UnitSystem): string {
  if (km >= SHORT_KM) return formatDistance(km, units);
  const metres = km * 1000;
  const value = isImperial(units) ? metres * YARDS_PER_METRE : metres;
  return `${Math.round(value)} ${shortDistanceUnit(units)}`;
}

export function formatElevation(metres: number, units: UnitSystem): string {
  return `${Math.round(toElevation(metres, units))} ${elevationUnit(units)}`;
}

export function formatSpeed(kph: number, units: UnitSystem): string {
  return `${Math.round(toSpeed(kph, units))} ${speedUnit(units)}`;
}
