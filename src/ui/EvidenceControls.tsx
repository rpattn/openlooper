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

/**
 * The overlay lists sources under what they actually claim, so a recorded
 * right of way is never read as somebody having been recorded walking it.
 */
const KIND_GROUPS = [
  { kind: "use", label: "Recorded use" },
  { kind: "status", label: "Recorded designation" },
  { kind: "context", label: "Recorded surroundings" },
] as const;

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
    { key: "character", label: "Route character", max: 50 },
  ];
  return (
    <details className="panel-section evidence-controls">
      <summary>Route-use evidence</summary>
      <small className="evidence-readiness">
        {available ? "Evidence service ready" : "Evidence service unavailable"}
      </small>
      <label>
        Map overlay
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
          {KIND_GROUPS.map(({ kind, label }) => {
            const sources = (props.status?.sources ?? []).filter(
              (source) => source.kind === kind,
            );
            return sources.length ? (
              <optgroup key={kind} label={label}>
                {sources.map((source) => (
                  <option key={source.source_id} value={source.source_id}>
                    {source.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
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
          disabled={!props.hasRoute || !available}
          onChange={(event) => props.onSelectedRouteEvidence(event.target.checked)}
        />
        Selected-route overlay
      </label>
      {import.meta.env.DEV && (
        <details className="scoring-diagnostics">
          <summary>Scoring diagnostics</summary>
          <label>
            <input
              type="checkbox"
              checked={props.evidenceRanking}
              onChange={(event) => props.onEvidenceRanking(event.target.checked)}
            />
            Rank completed candidates on route character
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
        </details>
      )}
      <p>No route-use evidence means unknown, not unused, unsafe or unsuitable.</p>
    </details>
  );
}
