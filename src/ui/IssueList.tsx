import { AlertTriangle, CircleHelp, ExternalLink } from "lucide-react";
import type { RouteIssue } from "../domain/models";

export function IssueList({
  issues,
  attributed,
  selected,
  onSelect,
}: {
  issues: RouteIssue[];
  attributed: boolean;
  selected?: string;
  onSelect: (issue: RouteIssue) => void;
}) {
  if (!attributed)
    return (
      <div className="empty-small">
        Route-quality attribution is unavailable for this route. Routing and
        elevation remain usable; no segment-quality conclusion can be drawn.
      </div>
    );
  if (!issues.length)
    return (
      <div className="empty-small">
        No route-quality issues were identified from the available Valhalla
        attributes. This is not a safety guarantee.
      </div>
    );
  return (
    <div className="issues">
      {issues.map((issue) => (
        <button
          key={issue.id}
          className={selected === issue.id ? "selected" : ""}
          onClick={() => onSelect(issue)}
        >
          <span className={`issue-icon issue-icon--${issue.severity}`}>
            {issue.confidence === "unknown" ? (
              <CircleHelp size={18} />
            ) : (
              <AlertTriangle size={18} />
            )}
          </span>
          <span>
            <strong>{issue.title}</strong>
            <small>
              {issue.explanation} ·{" "}
              {issue.lengthKm < 0.1
                ? `${Math.round(issue.lengthKm * 1000)} m`
                : `${issue.lengthKm.toFixed(1)} km`}
            </small>
            {issue.attributes.wayId && (
              <a
                href={`https://www.openstreetmap.org/way/${issue.attributes.wayId}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                View recorded OSM way <ExternalLink size={12} />
              </a>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
