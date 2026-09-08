import { AlertTriangle, CircleHelp, ExternalLink } from "lucide-react";
import type { RouteIssue } from "../domain/models";

function formatLength(km: number) {
  return km < 0.1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/**
 * Collapses the "not recorded" notes into one line per kind. They are honest
 * and they score nothing, but there are usually more of them than there are
 * real findings, and leading with them buries what the planner needs to see.
 */
function UnknownSummary({ issues }: { issues: RouteIssue[] }) {
  const byTitle = new Map<string, { title: string; km: number; count: number }>();
  for (const issue of issues) {
    const entry = byTitle.get(issue.title) ?? {
      title: issue.title,
      km: 0,
      count: 0,
    };
    entry.km += issue.lengthKm;
    entry.count += 1;
    byTitle.set(issue.title, entry);
  }
  const rows = [...byTitle.values()].sort((a, b) => b.km - a.km);
  return (
    <details className="issues-unknown">
      <summary>
        <span className="issue-icon issue-icon--info">
          <CircleHelp size={18} />
        </span>
        <span>
          <strong>
            {rows.length === 1
              ? "1 thing is not recorded"
              : `${rows.length} things are not recorded`}
          </strong>
          <small>
            Missing data is not evidence of absence, and none of it affects
            ranking.
          </small>
        </span>
      </summary>
      <ul>
        {rows.map((row) => (
          <li key={row.title}>
            {row.title} · {formatLength(row.km)} over{" "}
            {row.count === 1 ? "1 section" : `${row.count} sections`}
          </li>
        ))}
      </ul>
    </details>
  );
}

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
  const recorded = issues.filter((issue) => issue.confidence !== "unknown");
  const unknown = issues.filter((issue) => issue.confidence === "unknown");
  if (!issues.length)
    return (
      <div className="empty-small">
        No route-quality issues were identified from the available Valhalla
        attributes. This is not a safety guarantee.
      </div>
    );
  return (
    <div className="issues">
      {recorded.map((issue) => (
        <button
          key={issue.id}
          className={selected === issue.id ? "selected" : ""}
          onClick={() => onSelect(issue)}
        >
          <span className={`issue-icon issue-icon--${issue.severity}`}>
            <AlertTriangle size={18} />
          </span>
          <span>
            <strong>{issue.title}</strong>
            <small>
              {issue.explanation} · {formatLength(issue.lengthKm)}
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
      {!recorded.length && (
        <div className="empty-small">
          Nothing recorded about this route counts against it. This is not a
          safety guarantee.
        </div>
      )}
      {unknown.length > 0 && <UnknownSummary issues={unknown} />}
    </div>
  );
}
