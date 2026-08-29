import type { Activity, RouteResult } from "./models";
import { cumulativeDistances } from "./geometry";

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function createGpx(
  route: RouteResult,
  activity: Activity,
  name = `OpenLooper ${activity}`,
): string {
  const elevation = route.elevation;
  const cumulative = cumulativeDistances(route.geometry);
  const geometryDistance = cumulative.at(-1) ?? 0;
  const elevationAt = (distanceKm: number) => {
    if (!elevation.length) return undefined;
    const upper = elevation.findIndex((point) => point.distanceKm >= distanceKm);
    if (upper <= 0) return elevation[0]!.elevationM;
    if (upper < 0) return elevation.at(-1)!.elevationM;
    const before = elevation[upper - 1]!;
    const after = elevation[upper]!;
    const span = after.distanceKm - before.distanceKm;
    const ratio = span ? (distanceKm - before.distanceKm) / span : 0;
    return before.elevationM + (after.elevationM - before.elevationM) * ratio;
  };
  const points = route.geometry
    .map((p, i) => {
      const e = elevationAt(
        geometryDistance
          ? (cumulative[i]! / geometryDistance) * route.distanceKm
          : 0,
      );
      return `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${e === undefined ? "" : `<ele>${e.toFixed(1)}</ele>`}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OpenLooper" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time><desc>${activity}; ${route.distanceKm.toFixed(2)} km</desc></metadata>
  <trk><name>${esc(name)}</name><type>${activity}</type><trkseg>
${points}
  </trkseg></trk>
</gpx>`;
}
export function downloadGpx(route: RouteResult, activity: Activity) {
  const blob = new Blob([createGpx(route, activity)], {
    type: "application/gpx+xml",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `openlooper-${activity}-${route.distanceKm.toFixed(1)}km.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
