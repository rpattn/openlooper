import { ExternalLink, X } from "lucide-react";
import type { RouteEdge } from "../domain/models";

const recorded = (value?: string) =>
  !value || value === "none" ? "Not recorded" : value.replaceAll("_", " ");

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
    ["Use", recorded(attributes.use)],
    ["Road class", recorded(attributes.roadClass)],
    ["Surface", recorded(attributes.surface)],
    ["Travel mode", recorded(attributes.travelMode)],
    ["Travel type", recorded(attributes.travelType)],
    ["Sidewalk", recorded(attributes.sidewalk)],
    ["Cycle lane", recorded(attributes.cycleLane)],
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
    ["Maximum grade", grade >= 32000 ? "Unavailable" : `${grade.toFixed(0)}%`],
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
