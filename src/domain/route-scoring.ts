import { distanceKm } from "./geometry";
import type {
  Coordinate,
  LoopMetrics,
  RouteIssue,
  RouteResult,
} from "./models";

export const LOOP_LIMITS = {
  maxDistanceError: 0.3,
  maxRepeatedCoverage: 0.35,
  dedupeSimilarity: 0.75,
  refinementMin: 0.75,
  refinementMax: 1.25,
  maxConcurrent: 4,
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
  evidenceRanking = false,
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
  const maxRadius = Math.max(
    ...route.geometry.map((p) => distanceKm(start, p)),
  );
  const compactnessPenalty = Math.min(
    1,
    Math.max(0, maxRadius / (target * 0.35) - 1),
  );
  const issueKm = issues.reduce(
    (s, i) =>
      s +
      (i.confidence === "unknown"
        ? 0
        : i.lengthKm *
          (i.severity === "high" ? 2 : i.severity === "warning" ? 1 : 0.25)),
    0,
  );
  const issuePenalty = Math.min(1, issueKm / Math.max(route.distanceKm, 1));
  const baseScore = Math.max(
    0,
    100 -
      (Math.min(1, error / 0.3) * 45 +
        repeated * 25 +
        Math.max(compactnessPenalty, early) * 10 +
        issuePenalty * 20),
  );
  const evidenceBonus =
    evidenceRanking &&
    route.useEvidence?.status === "available" &&
    !issues.some((issue) => issue.severity === "high")
      ? Math.min(3, (route.useEvidence.evidencedDistancePct / 100) * 3)
      : 0;
  return {
    distanceError: error,
    repeatedCoverage: repeated,
    compactnessPenalty,
    earlyReturnPenalty: early,
    issuePenalty,
    baseScore,
    evidenceBonus,
    score: baseScore + evidenceBonus,
  };
}
