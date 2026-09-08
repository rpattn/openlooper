import { ExternalLink, X } from "lucide-react";
import type { RouteEdge } from "../domain/models";
import {
  cycleLaneName,
  roadClassName,
  sidewalkName,
  surfaceName,
  travelModeName,
  travelTypeName,
  useName,
} from "../domain/vocabulary";

const recorded = (value?: string) => value ?? "Not recorded";

export function EdgeDetails({
  edge,
  onClose,
}: {
  edge: RouteEdge;
  onClose: () => void;
}) {
  const attributes = edge.attributes;
  const grade = Math.max(
    Math.abs(attributes.maxUpwardGrade ?? 0),
    Math.abs(attributes.maxDownwardGrade ?? 0),
  );
  const length =
    edge.lengthKm < 0.1
      ? `${Math.round(edge.lengthKm * 1000)} m`
      : `${edge.lengthKm.toFixed(1)} km`;
  const details = [
    ["Way", attributes.name ?? "Unnamed"],
    ["Kind", recorded(useName(attributes.use))],
    ["Road type", recorded(roadClassName(attributes.roadClass))],
    ["Surface", recorded(surfaceName(attributes.surface))],
    ["Suitable for", recorded(travelModeName(attributes.travelMode))],
    ["Travel type", recorded(travelTypeName(attributes.travelType))],
    ["Pavement", recorded(sidewalkName(attributes.sidewalk))],
    ["Cycle lane", recorded(cycleLaneName(attributes.cycleLane))],
    [
      "Shoulder",
      attributes.shoulder === undefined
        ? "Not recorded"
        : attributes.shoulder
          ? "Recorded"
          : "Not recorded",
    ],
    [
      "Lanes",
      attributes.laneCount === undefined
        ? "Not recorded"
        : String(attributes.laneCount),
    ],
    [
      "Bicycle network",
      !attributes.bicycleNetwork
        ? "Not recorded"
        : String(attributes.bicycleNetwork),
    ],
    ["Steepest point", grade >= 32000 ? "Unavailable" : `${grade.toFixed(0)}%`],
  ];
  return (
    <section className="panel-section edge-details" aria-live="polite">
      <div className="section-title">
        <h2>Route segment</h2>
        <button
          className="icon-button"
          aria-label="Close route segment details"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <p className="hint">
        Recorded attributes for this {length} segment.
      </p>
      <dl>
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {attributes.wayId && (
        <a
          href={`https://www.openstreetmap.org/way/${attributes.wayId}`}
          target="_blank"
          rel="noreferrer"
        >
          View recorded OSM way <ExternalLink size={13} />
        </a>
      )}
      <p className="disclaimer">
        Normalized Valhalla data may be incomplete or derived from importer
        defaults.
      </p>
    </section>
  );
}
