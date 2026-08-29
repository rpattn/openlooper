import type { EvidenceStatus } from "../evidence/evidence-client";

type Props = {
  status?: EvidenceStatus;
  viewportSource?: string;
  onViewportSource: (source?: string) => void;
  selectedRouteEvidence: boolean;
  onSelectedRouteEvidence: (enabled: boolean) => void;
  evidenceRanking: boolean;
  onEvidenceRanking: (enabled: boolean) => void;
  hasRoute: boolean;
};

export function EvidenceControls(props: Props) {
  const available = Boolean(props.status?.ready);
  return (
    <aside className="evidence-controls" aria-label="Route-use evidence debugging">
      <strong>Use evidence · development</strong>
      <small>{available ? "Evidence service ready" : "Evidence service unavailable"}</small>
      <label>
        Viewport layer
        <select
          disabled={!available}
          value={props.viewportSource ?? "off"}
          onChange={(event) =>
            props.onViewportSource(
              event.target.value === "off" ? undefined : event.target.value,
            )
          }
        >
          <option value="off">Off</option>
          <option value="any">Any evidence</option>
          {(props.status?.sources ?? []).map((source) => (
            <option key={source.source_id} value={source.source_id}>
              {source.source_id}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.selectedRouteEvidence}
          disabled={!props.hasRoute}
          onChange={(event) => props.onSelectedRouteEvidence(event.target.checked)}
        />
        Selected-route overlay
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.evidenceRanking}
          onChange={(event) => props.onEvidenceRanking(event.target.checked)}
        />
        Add evidence ranking bonus
      </label>
      <p>No route-use evidence means unknown, not unused, unsafe or unsuitable.</p>
    </aside>
  );
}
