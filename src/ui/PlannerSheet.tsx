import {
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { ACTIVITY } from "../domain/activity-profiles";
import type {
  Activity,
  CreationMode,
  PlannerState,
  RouteIssue,
  RoutingPreferences,
  SurfaceTolerance,
} from "../domain/models";
import { characterPreferenceHint } from "../domain/vocabulary";
import { ActivitySelector } from "./ActivitySelector";
import { ElevationProfile } from "./ElevationProfile";
import { EdgeDetails } from "./EdgeDetails";
import { IssueList } from "./IssueList";
import { RouteSummary } from "./RouteSummary";

type Props = {
  state: PlannerState;
  onMode: (mode: CreationMode) => void;
  onActivity: (activity: Activity) => void;
  onPreferences: (preferences: RoutingPreferences) => void;
  onTool: (tool: PlannerState["activeTool"]) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onSelectAlternative: (id: string) => void;
  onReverse: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onRegenerate: () => void;
  onIssue: (issue: RouteIssue) => void;
  onProfile: (coordinate?: { lat: number; lon: number }) => void;
  onEdgeDismiss: () => void;
  onSheet: (sheet: PlannerState["sheet"]) => void;
  onTarget: (km: number) => void;
  evidenceControls?: ReactNode;
};
export function PlannerSheet(p: Props) {
  const state = p.state;
  const pref = state.plan.preferences;
  const selectedEdge =
    state.highlightedEdgeIndex === undefined
      ? undefined
      : state.selectedRoute?.edges[state.highlightedEdgeIndex];
  return (
    <aside
      className={`planner planner--${state.sheet}`}
      style={{ "--accent": ACTIVITY[state.plan.activity].color } as CSSProperties}
    >
      <div className="sheet-handle" />
      <div className="planner-top">
        <div>
          <span className="eyebrow">OpenLooper</span>
          <h1>Make a route worth taking</h1>
        </div>
        <div className="sheet-buttons">
          <button
            aria-label="Show less"
            onClick={() =>
              p.onSheet(state.sheet === "full" ? "half" : "collapsed")
            }
          >
            <ChevronDown />
          </button>
          <button
            aria-label="Show more"
            onClick={() =>
              p.onSheet(state.sheet === "collapsed" ? "half" : "full")
            }
          >
            <ChevronUp />
          </button>
        </div>
      </div>
      <ActivitySelector value={state.plan.activity} onChange={p.onActivity} />
      <div className="segmented" aria-label="Route creation mode">
        {(
          [
            ["pointToPoint", "A → B"],
            ["loop", "Loop"],
            ["sketch", "Sketch"],
          ] as [CreationMode, string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            className={state.plan.mode === mode ? "active" : ""}
            onClick={() => p.onMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="planner-scroll">
        {state.plan.mode === "loop" ? (
          <section className="panel-section">
            <label className="field">
              <span>Target distance</span>
              <span className="distance-input">
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="0.5"
                  value={state.plan.targetDistanceKm ?? 10}
                  onChange={(e) => p.onTarget(Number(e.target.value))}
                />{" "}
                km
              </span>
            </label>
            <p className="hint">
              Choose a start on the map, then generate up to three distinct
              routes.
            </p>
            <button
              className="primary"
              disabled={!state.plan.waypoints.length || state.loading}
              onClick={p.onGenerate}
            >
              <Sparkles size={18} />
              {state.alternatives.length ? "Generate loops" : "Find loops"}
            </button>
            {state.alternatives.length > 0 && (
              <button
                className="secondary"
                disabled={state.loading}
                onClick={p.onRegenerate}
              >
                <RefreshCw size={17} />
                Regenerate differently
              </button>
            )}
          </section>
        ) : (
          <section className="panel-section">
            <div
              className={`tool-grid${state.plan.mode === "sketch" ? " tool-grid--sketch" : ""}`}
            >
              {state.plan.mode !== "sketch" && (
                <button
                  className={state.activeTool === "start" ? "selected" : ""}
                  onClick={() => p.onTool("start")}
                >
                  <MapPin />
                  Set start
                </button>
              )}
              {state.plan.mode === "pointToPoint" && (
                <button
                  className={
                    state.activeTool === "destination" ? "selected" : ""
                  }
                  onClick={() => p.onTool("destination")}
                >
                  <Route />
                  Set finish
                </button>
              )}
              <button
                className={state.activeTool === "add" ? "selected" : ""}
                disabled={
                  !state.selectedRoute ||
                  (state.plan.mode === "sketch" && !state.sketchCompleted)
                }
                onClick={() => p.onTool("add")}
              >
                <Plus />
                Add point
              </button>
            </div>
            <p className="hint">
              {state.plan.mode === "sketch"
                ? state.sketchCompleted
                  ? "Sketch complete. Use Add point or drag points to edit the routed shape."
                  : state.plan.waypoints.length < 2
                    ? "Tap the map to place a start and endpoint."
                    : "Keep tapping to extend. Tap A to close a loop or the current endpoint to finish A → B."
                : "Select a tool, then tap the map. Drag any point to edit."}
            </p>
          </section>
        )}
        {state.plan.waypoints.length > 0 && (
          <section className="panel-section waypoint-list">
            <div className="section-title">
              <h2>Points</h2>
              <div>
                <button
                  className="icon-button"
                  title="Reverse points"
                  onClick={p.onReverse}
                >
                  <Repeat2 />
                </button>
                <button
                  className="icon-button"
                  title="Clear route"
                  onClick={p.onClear}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
            {state.plan.waypoints.map((w, i) => (
              <div key={w.id}>
                <span className={`point-dot point-dot--${w.role}`}>
                  {i + 1}
                </span>
                <span>
                  {w.role === "generated"
                    ? "Loop shaping point"
                    : state.plan.mode === "loop" && w.role === "destination"
                      ? "Return to start"
                    : w.role[0]!.toUpperCase() + w.role.slice(1)}
                </span>
                {state.plan.waypoints.length > 2 &&
                  i > 0 &&
                  i < state.plan.waypoints.length - 1 && (
                    <button
                      className="icon-button"
                      aria-label={`Remove point ${i + 1}`}
                      onClick={() => p.onRemove(w.id)}
                    >
                      <X />
                    </button>
                  )}
              </div>
            ))}
          </section>
        )}
        <details className="panel-section preferences">
          <summary>Route preferences</summary>
          <label className="preference-scale">
            Route character
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              value={pref.character}
              aria-label="Route character, from direct and paved to green and quiet"
              onChange={(e) =>
                p.onPreferences({ ...pref, character: Number(e.target.value) })
              }
            />
            <span className="scale-ends">
              <span>Direct &amp; paved</span>
              <span>Green &amp; quiet</span>
            </span>
            <small>{characterPreferenceHint(pref.character)}</small>
          </label>
          <label>
            Surface
            <select
              value={pref.surfaceTolerance}
              onChange={(e) =>
                p.onPreferences({
                  ...pref,
                  surfaceTolerance: e.target.value as SurfaceTolerance,
                })
              }
            >
              <option value="paved">Paved only</option>
              <option value="firm">Firm paths too</option>
              <option value="any">Anything, including tracks</option>
            </select>
            <small>
              What to route over. Recorded surfaces are incomplete, so this
              steers the route rather than guaranteeing what you will find.
            </small>
          </label>
          <label className="preference-scale">
            Hills
            <input
              type="range"
              min="0"
              max="1"
              step=".1"
              value={pref.hillPreference}
              aria-label="Hill preference, from flattest to seek hills"
              onChange={(e) =>
                p.onPreferences({
                  ...pref,
                  hillPreference: Number(e.target.value),
                })
              }
            />
            <span className="scale-ends">
              <span>Flattest</span>
              <span>Seek hills</span>
            </span>
          </label>
          <fieldset className="preference-avoid">
            <legend>Avoid</legend>
            <label>
              <input
                type="checkbox"
                checked={pref.avoidSteps}
                onChange={(e) =>
                  p.onPreferences({ ...pref, avoidSteps: e.target.checked })
                }
              />{" "}
              Steps
            </label>
            {state.plan.activity !== "cycle" && (
              <label>
                <input
                  type="checkbox"
                  checked={pref.preferLit}
                  onChange={(e) =>
                    p.onPreferences({ ...pref, preferLit: e.target.checked })
                  }
                />{" "}
                Unlit roads where recorded
              </label>
            )}
            <small>
              Lighting is recorded on about a tenth of local ways, and the ways
              that carry it are mostly main roads: preferring lit sections makes
              routes longer and busier.
            </small>
          </fieldset>
        </details>
        {p.evidenceControls}
        {state.loading && (
          <div className="status status--loading">
            <span className="spinner" />
            <span>{state.progress ?? "Calculating route…"}</span>
            <button className="status-cancel" onClick={p.onCancel}>
              Stop
            </button>
          </div>
        )}
        {state.error && (
          <div className="status status--error">{state.error}</div>
        )}
        {state.alternatives.length > 1 && (
          <section className="panel-section">
            <h2>
              {state.plan.mode === "loop" ? "Loop choices" : "Route choices"}
            </h2>
            <div className="alternatives">
              {state.alternatives.map((a, i) => (
                <button
                  key={a.id}
                  className={
                    a.result.id === state.selectedRoute?.id ? "selected" : ""
                  }
                  onClick={() => p.onSelectAlternative(a.id)}
                >
                  <strong>
                    {String.fromCharCode(65 + i)} ·{" "}
                    {a.result.distanceKm.toFixed(1)} km
                  </strong>
                  <small>{a.label}</small>
                  {import.meta.env.DEV && a.metrics && (
                    <span className="score-breakdown">
                      Distance −{a.metrics.distancePenaltyPoints.toFixed(1)} ·
                      Repetition −
                      {a.metrics.repetitionPenaltyPoints.toFixed(1)} · Geometry −
                      {a.metrics.geometryPenaltyPoints.toFixed(1)} · Issues −
                      {a.metrics.issuePenaltyPoints.toFixed(1)} · Character{" "}
                      {a.metrics.characterPoints >= 0 ? "+" : "−"}
                      {Math.abs(a.metrics.characterPoints).toFixed(1)} · Final{" "}
                      {a.metrics.score.toFixed(1)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
        {state.selectedRoute && (
          <>
            <RouteSummary
              route={state.selectedRoute}
              activity={state.plan.activity}
            />
            <section className="panel-section detail-section">
              <h2>Elevation</h2>
              <ElevationProfile
                points={state.selectedRoute.elevation}
                onPoint={p.onProfile}
              />
            </section>
            {selectedEdge && (
              <EdgeDetails edge={selectedEdge} onClose={p.onEdgeDismiss} />
            )}
            <section className="panel-section detail-section">
              <h2>
                Route notes <span>{state.selectedRoute.issues.length}</span>
              </h2>
              <IssueList
                issues={state.selectedRoute.issues}
                attributed={state.selectedRoute.edges.length > 0}
                selected={state.highlightedIssueId}
                onSelect={p.onIssue}
              />
              <p className="disclaimer">
                Based on normalized route data. Not a guarantee of safety,
                accessibility, surface condition, traffic, lighting, or current
                hazards.
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
