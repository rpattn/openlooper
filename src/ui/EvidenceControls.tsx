import type {
  LoopScoringWeights,
  ViewportEvidenceState,
} from "../domain/models";
import { DEFAULT_LOOP_SCORING_WEIGHTS } from "../domain/route-scoring";
import type { EvidenceStatus } from "../evidence/evidence-client";

type Props = {
  status?: EvidenceStatus;
  viewportSource?: string;
  onViewportSource: (source?: string) => void;
  viewportState: ViewportEvidenceState;
  selectedRouteEvidence: boolean;
  onSelectedRouteEvidence: (enabled: boolean) => void;
  evidenceRanking: boolean;
  onEvidenceRanking: (enabled: boolean) => void;
  scoringWeights: LoopScoringWeights;
  onScoringWeights: (weights: LoopScoringWeights) => void;
  hasRoute: boolean;
};

export function EvidenceControls(props: Props) {
  const available = Boolean(props.status?.ready);
  const sliders: Array<{
    key: keyof LoopScoringWeights;
    label: string;
    max: number;
  }> = [
    { key: "distance", label: "Target distance", max: 50 },
    { key: "repetition", label: "Repetition", max: 50 },
    { key: "geometry", label: "Loop geometry", max: 30 },
    { key: "issues", label: "Route issues", max: 70 },
    { key: "evidence", label: "Evidence bonus", max: 15 },
  ];
  return (
    <details className="panel-section development-tools" open>
      <summary>Development tools</summary>
      <small className="development-readiness">
        {available ? "Evidence service ready" : "Evidence service unavailable"}
      </small>
      <label>
        Viewport evidence
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
              {source.label}
            </option>
          ))}
        </select>
      </label>
      <div className="viewport-evidence-state" aria-live="polite">
        {props.viewportState.loading
          ? `Loading… ${props.viewportState.count} sections shown`
          : props.viewportState.error
            ? `${props.viewportState.count} sections shown · ${props.viewportState.error}`
            : `${props.viewportState.count} sections returned`}
      </div>
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
        Rank completed candidates with evidence
      </label>
      <div className="scoring-sliders">
        {sliders.map(({ key, label, max }) => (
          <label key={key}>
            <span>{label}</span>
            <output>{props.scoringWeights[key]}</output>
            <input
              type="range"
              min="0"
              max={max}
              step="1"
              value={props.scoringWeights[key]}
              aria-label={`${label} points`}
              onChange={(event) =>
                props.onScoringWeights({
                  ...props.scoringWeights,
                  [key]: Number(event.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <button
        className="secondary development-reset"
        onClick={() => props.onScoringWeights(DEFAULT_LOOP_SCORING_WEIGHTS)}
      >
        Reset defaults
      </button>
      <p>No route-use evidence means unknown, not unused, unsafe or unsuitable.</p>
    </details>
  );
}
