import type {
  Activity,
  EdgeAttributes,
  RouteEdge,
  RouteIssue,
  RouteResult,
} from "./models";
import { randomId } from "./id";

function stringValue(
  edge: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = edge[key];
  return typeof value === "string" ? value : undefined;
}
function numberValue(
  edge: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = Number(edge[key]);
  return Number.isFinite(value) ? value : undefined;
}
function boolValue(
  edge: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = edge[key];
  return typeof value === "boolean" ? value : undefined;
}

export function mapEdges(
  raw: Array<Record<string, unknown>>,
  geometryLength: number,
): RouteEdge[] {
  return raw
    .map((edge) => ({
      beginIndex: Math.max(
        0,
        Math.round(numberValue(edge, "begin_shape_index") ?? 0),
      ),
      endIndex: Math.min(
        geometryLength - 1,
        Math.round(numberValue(edge, "end_shape_index") ?? 0),
      ),
      lengthKm: numberValue(edge, "length") ?? 0,
      attributes: {
        name: (edge.names as string[] | undefined)?.[0],
        roadClass: stringValue(edge, "road_class"),
        use: stringValue(edge, "use"),
        surface: stringValue(edge, "surface"),
        travelMode: stringValue(edge, "travel_mode"),
        travelType: stringValue(edge, "travel_type"),
        unpaved: boolValue(edge, "unpaved"),
        sidewalk: stringValue(edge, "sidewalk"),
        cycleLane: stringValue(edge, "cycle_lane"),
        shoulder: boolValue(edge, "shoulder"),
        laneCount: numberValue(edge, "lane_count"),
        bicycleNetwork: numberValue(edge, "bicycle_network"),
        maxUpwardGrade: numberValue(edge, "max_upward_grade"),
        maxDownwardGrade: numberValue(edge, "max_downward_grade"),
        speedKph: numberValue(edge, "speed"),
        wayId: numberValue(edge, "way_id"),
      },
    }))
    .filter((edge) => edge.endIndex > edge.beginIndex);
}

type Finding = Omit<
  RouteIssue,
  "id" | "beginIndex" | "endIndex" | "lengthKm" | "geometry" | "attributes"
>;
function findings(attributes: EdgeAttributes, activity: Activity): Finding[] {
  const found: Finding[] = [];
  const use = (attributes.use ?? "").toLowerCase();
  const road = (attributes.roadClass ?? "").toLowerCase();
  const surface = (attributes.surface ?? "").toLowerCase();
  if (use.includes("steps"))
    found.push({
      category: "steps",
      severity: "high",
      confidence: "observed",
      title: "Steps recorded",
      explanation: "Valhalla identifies this section as steps.",
    });
  if (["motorway", "trunk", "primary"].some((value) => road.includes(value)))
    found.push({
      category: "majorRoad",
      severity: road.includes("motorway") ? "high" : "warning",
      confidence: "potential",
      title: "Potential issue: major-road section",
      explanation: `Recorded as ${attributes.roadClass ?? "a major road"}; it may be unpleasant for this activity.`,
    });
  if (
    attributes.unpaved ||
    ["dirt", "gravel", "earth", "mud", "rough", "impassable"].some((value) =>
      surface.includes(value),
    )
  )
    found.push({
      category: "surface",
      severity: surface.includes("impassable") ? "high" : "warning",
      confidence: surface.includes("impassable") ? "observed" : "potential",
      title: surface.includes("impassable")
        ? "Impassable surface recorded"
        : attributes.unpaved
          ? "Potential issue: unpaved section"
          : "Potential issue: rough surface",
      explanation: `Valhalla records ${attributes.surface ?? "an unpaved surface"}; suitability depends on conditions and your equipment.`,
    });
  const gradeMissing =
    (attributes.maxUpwardGrade ?? 0) <= -32000 ||
    (attributes.maxDownwardGrade ?? 0) <= -32000;
  const grade = Math.max(
    Math.abs(attributes.maxUpwardGrade ?? 0),
    Math.abs(attributes.maxDownwardGrade ?? 0),
  );
  const threshold = activity === "cycle" ? 10 : 12;
  if (gradeMissing)
    found.push({
      category: "gradientUnknown",
      severity: "info",
      confidence: "unknown",
      title: "Gradient unavailable",
      explanation: "Elevation-derived grade is unavailable for this section.",
    });
  else if (grade > threshold)
    found.push({
      category: "steep",
      severity: "warning",
      confidence: "potential",
      title: `Potential issue: steep section (up to ${grade.toFixed(0)}%)`,
      explanation: "Potential issue based on Valhalla elevation-derived grade.",
    });
  const isRoad =
    use.includes("road") ||
    [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "residential",
    ].some((value) => road.includes(value));
  if (
    isRoad &&
    activity !== "cycle" &&
    (!attributes.sidewalk || attributes.sidewalk === "none")
  )
    found.push({
      category: "sidewalkUnknown",
      severity: "info",
      confidence: "unknown",
      title: "Pavement/sidewalk not recorded",
      explanation: "Missing data is not evidence that no pavement exists.",
    });
  if (
    isRoad &&
    activity === "cycle" &&
    (!attributes.cycleLane || attributes.cycleLane === "none")
  )
    found.push({
      category: "cycleInfraUnknown",
      severity: "info",
      confidence: "unknown",
      title: "Cycle infrastructure not recorded",
      explanation:
        "This does not prove that no separate or nearby cycle facility exists.",
    });
  if (
    !surface ||
    surface === "default" ||
    surface === "unknown" ||
    surface === "paved"
  )
    found.push({
      category: "surfaceUnknown",
      severity: "info",
      confidence: "unknown",
      title: "Surface detail uncertain",
      explanation:
        "Valhalla does not expose enough provenance to claim a tagged surface here.",
    });
  return found;
}

function addIssue(
  issues: RouteIssue[],
  result: RouteResult,
  edge: RouteEdge,
  finding: Finding,
) {
  let previous: RouteIssue | undefined;
  for (let index = issues.length - 1; index >= 0; index--) {
    const issue = issues[index]!;
    if (
      issue.category === finding.category &&
      issue.endIndex === edge.beginIndex
    ) {
      previous = issue;
      break;
    }
  }
  if (previous) {
    previous.endIndex = edge.endIndex;
    previous.lengthKm += edge.lengthKm;
    previous.geometry = result.geometry.slice(
      previous.beginIndex,
      edge.endIndex + 1,
    );
    return;
  }
  issues.push({
    ...finding,
    id: randomId(),
    beginIndex: edge.beginIndex,
    endIndex: edge.endIndex,
    lengthKm: edge.lengthKm,
    geometry: result.geometry.slice(edge.beginIndex, edge.endIndex + 1),
    attributes: edge.attributes,
  });
}

export function analyzeRoute(
  result: RouteResult,
  edges: RouteEdge[],
  activity: Activity,
): RouteIssue[] {
  const issues: RouteIssue[] = [];
  edges.forEach((edge) =>
    findings(edge.attributes, activity).forEach((finding) =>
      addIssue(issues, result, edge, finding),
    ),
  );
  for (let index = 1; index < edges.length; index++) {
    const previousUse = (edges[index - 1]!.attributes.use ?? "").toLowerCase();
    const edge = edges[index]!;
    const currentUse = (edge.attributes.use ?? "").toLowerCase();
    const currentRoad = (edge.attributes.roadClass ?? "").toLowerCase();
    const isRoad =
      currentUse.includes("road") ||
      [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "residential",
      ].some((value) => currentRoad.includes(value));
    if (previousUse.includes("footway") && isRoad)
      addIssue(issues, result, edge, {
        category: "footwayEnds",
        severity: "warning",
        confidence: "observed",
        title: "Dedicated footway ends",
        explanation:
          "The recorded footway ends and the route continues on a road edge.",
      });
  }
  return issues.sort(
    (a, b) => a.beginIndex - b.beginIndex || (a.severity === "high" ? -1 : 1),
  );
}
