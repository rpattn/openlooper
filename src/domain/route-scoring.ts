import { distanceKm } from "./geometry";
import type {
  Activity,
  Coordinate,
  LoopMetrics,
  LoopScoringWeights,
  RouteIssue,
  RouteResult,
} from "./models";
import { blockingFactor, characterScore, issueKilometres } from "./route-character";

/**
 * Points by activity. The issue budget is smaller than it was and the character
 * term much larger, because the old split gave a route no way to be good — only
 * ways to be less bad. Walking tolerates a rough surface and a slow climb, so
 * more of its budget sits in character; cycling cares more about what the
 * surface and the traffic actually are, so more of its budget stays in issues.
 */
export const ACTIVITY_SCORING_WEIGHTS: Record<Activity, LoopScoringWeights> = {
  run: { distance: 15, repetition: 25, geometry: 10, issues: 30, character: 25 },
  walk: { distance: 15, repetition: 22, geometry: 10, issues: 25, character: 30 },
  cycle: { distance: 15, repetition: 25, geometry: 10, issues: 35, character: 20 },
};

export const DEFAULT_LOOP_SCORING_WEIGHTS: LoopScoringWeights =
  ACTIVITY_SCORING_WEIGHTS.run;

export function scoringWeightsFor(activity: Activity): LoopScoringWeights {
  return ACTIVITY_SCORING_WEIGHTS[activity];
}

export const LOOP_LIMITS = {
  maxDistanceError: 0.3,
  maxRepeatedCoverage: 0.35,
  dedupeSimilarity: 0.75,
  refinementMin: 0.75,
  refinementMax: 1.25,
  /**
   * Concurrency per phase rather than one cap for all of them. Seeds are plain
   * `/route` calls the graph answers together in well under a second, so a
   * single wave costs nothing and saves two wave boundaries. `trace_attributes`
   * is the heavier call and keeps the conservative cap.
   */
  seedConcurrency: 12,
  refineConcurrency: 8,
  traceConcurrency: 4,
};
function key(p: Coordinate) {
  return `${Math.round(p.lat * 2000)},${Math.round(p.lon * 2000)}`;
}
export function repeatedCoverage(points: Coordinate[]): number {
  if (points.length < 2) return 1;
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative[index - 1]! + distanceKm(points[index - 1]!, points[index]!));
  const total = cumulative.at(-1) ?? 0;
  const sequence: string[] = [];
  points.forEach((point, index) => {
    if (cumulative[index]! <= 0.1 || total - cumulative[index]! <= 0.1) return;
    const cell = key(point);
    if (sequence.at(-1) !== cell) sequence.push(cell);
  });
  const lastVisit = new Map<string, number>();
  let repeats = 0;
  for (let index = 0; index < sequence.length; index++) {
    const cell = sequence[index]!;
    const previous = lastVisit.get(cell);
    if (previous !== undefined && index - previous > 2) repeats++;
    lastVisit.set(cell, index);
  }
  return sequence.length ? repeats / sequence.length : 1;
}
export function routeSimilarity(a: Coordinate[], b: Coordinate[]): number {
  if (!a.length || !b.length) return 0;
  const sample = a.filter(
    (_, i) => i % Math.max(1, Math.floor(a.length / 100)) === 0,
  );
  const bKeys = new Set(b.map(key));
  return sample.filter((p) => bKeys.has(key(p))).length / sample.length;
}
export function hasDisconnectedJump(
  points: Coordinate[],
  target: number,
): boolean {
  for (let i = 1; i < points.length; i++)
    if (distanceKm(points[i - 1]!, points[i]!) > Math.max(0.5, target * 0.1))
      return true;
  return false;
}
export function scoreRoute(
  route: RouteResult,
  target: number,
  issues: RouteIssue[] = [],
  activity: Activity = "run",
  characterRanking = false,
  weights: LoopScoringWeights = ACTIVITY_SCORING_WEIGHTS[activity],
): LoopMetrics {
  const error = Math.abs(route.distanceKm - target) / target;
  const repeated = repeatedCoverage(route.geometry);
  const start = route.geometry[0]!;
  const middle = route.geometry.slice(
    Math.floor(route.geometry.length * 0.15),
    Math.floor(route.geometry.length * 0.85),
  );
  const early = middle.some(
    (p) => distanceKm(start, p) < Math.min(0.2, target * 0.03),
  )
    ? 1
    : 0;
  let maxRadius = 0;
  for (const point of route.geometry)
    maxRadius = Math.max(maxRadius, distanceKm(start, point));
  const compactnessPenalty = Math.min(
    1,
    Math.max(0, maxRadius / (target * 0.35) - 1),
  );
  const issuePenalty = Math.min(
    1,
    issueKilometres(issues, activity) / Math.max(route.distanceKm, 1),
  );
  const distancePenaltyPoints = Math.min(1, error / 0.3) * weights.distance;
  const repetitionPenaltyPoints = Math.min(1, repeated) * weights.repetition;
  const geometryPenaltyPoints =
    Math.max(compactnessPenalty, early) * weights.geometry;
  const issuePenaltyPoints = issuePenalty * weights.issues;
  const maximumBaseScore =
    weights.distance + weights.repetition + weights.geometry + weights.issues;
  const baseScore = Math.max(
    0,
    maximumBaseScore -
      distancePenaltyPoints -
      repetitionPenaltyPoints -
      geometryPenaltyPoints -
      issuePenaltyPoints,
  );
  // A route only earns character points once it has been attributed and
  // scored against evidence; before that the term stays absent rather than
  // zero, so an unmeasured candidate is never ranked as a bad one.
  const character =
    characterRanking && route.useEvidence?.status === "available"
      ? characterScore(activity, route.useEvidence.bySource)
      : undefined;
  const characterPoints =
    character === undefined
      ? 0
      : character *
        weights.character *
        // Blocking problems scale the term down with the distance they affect
        // rather than switching it off, and can only remove points a route
        // earned, never add to a penalty.
        (character > 0 ? blockingFactor(issues, route.distanceKm) : 1);
  return {
    distanceError: error,
    repeatedCoverage: repeated,
    compactnessPenalty,
    earlyReturnPenalty: early,
    issuePenalty,
    distancePenaltyPoints,
    repetitionPenaltyPoints,
    geometryPenaltyPoints,
    issuePenaltyPoints,
    character,
    characterPoints,
    baseScore,
    score: baseScore + characterPoints,
  };
}

/**
 * Scores each loop candidate once and keeps the viable ones, best first.
 * Distance error and repeated coverage both fall out of `scoreRoute`, so
 * reading them off the returned metrics avoids walking every geometry again in
 * the filter and twice more inside a sort comparator.
 */
export function rankCandidates<T extends { result: RouteResult }>(
  candidates: T[],
  target: number,
  activity: Activity,
  weights: LoopScoringWeights = ACTIVITY_SCORING_WEIGHTS[activity],
): Array<T & { metrics: LoopMetrics }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      metrics: scoreRoute(candidate.result, target, [], activity, false, weights),
    }))
    .filter(
      ({ result, metrics }) =>
        metrics.distanceError <= LOOP_LIMITS.maxDistanceError &&
        metrics.repeatedCoverage <= LOOP_LIMITS.maxRepeatedCoverage &&
        !hasDisconnectedJump(result.geometry, target),
    )
    .sort((a, b) => b.metrics.score - a.metrics.score);
}

export function repetitionDescription(repeated: number): string {
  if (repeated < 0.04) return "very little repetition";
  if (repeated < 0.08) return "low repetition";
  if (repeated < 0.16) return "some repeated sections";
  return "substantial repetition";
}

export function surfaceConcernPercentage(route: RouteResult): number {
  const concernKm = route.issues
    .filter(
      (issue) => issue.category === "surface" && issue.confidence !== "unknown",
    )
    .reduce((total, issue) => total + issue.lengthKm, 0);
  return Math.min(100, (concernKm / Math.max(route.distanceKm, 0.001)) * 100);
}
