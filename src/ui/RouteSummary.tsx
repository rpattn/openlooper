import { Clock3, Download, Mountain, Route } from "lucide-react";
import type { Activity, RouteResult } from "../domain/models";
import { downloadGpx } from "../domain/gpx";

const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes} min`;
};
export function RouteSummary({
  route,
  activity,
}: {
  route: RouteResult;
  activity: Activity;
}) {
  return (
    <section className="summary" aria-label="Route summary">
      <div>
        <Route size={17} />
        <strong>{route.distanceKm.toFixed(1)} km</strong>
      </div>
      <div>
        <Clock3 size={17} />
        <strong>{duration(route.durationSeconds)}</strong>
      </div>
      {route.ascentM !== undefined && (
        <div title="Approximate elevation gain and loss">
          <Mountain size={17} />
          <strong>
            ≈ {route.ascentM} m ↑ · {route.descentM} m ↓
          </strong>
        </div>
      )}
      {import.meta.env.DEV && route.useEvidence && (
        <div className="evidence-summary">
          <strong>
            {route.useEvidence.status === "available"
              ? `Route distance with use evidence: ${Math.round(route.useEvidence.evidencedDistancePct)}%`
              : "Route-use evidence unavailable"}
          </strong>
        </div>
      )}
      <button
        className="secondary"
        onClick={() => downloadGpx(route, activity)}
      >
        <Download size={17} />
        Export GPX
      </button>
    </section>
  );
}
