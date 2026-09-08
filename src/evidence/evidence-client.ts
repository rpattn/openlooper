import type { RouteEdge, RouteResult, RouteUseEvidence } from "../domain/models";
import { encodePolyline } from "../routing/valhalla-mapper";

const BASE = import.meta.env.VITE_EVIDENCE_URL ?? "/api/evidence";

export type EvidenceSource = {
  source_id: string;
  /**
   * What the source claims. `use` means somebody is recorded as having
   * travelled here; `status` a recorded legal or network designation; and
   * `context` something recorded about the way's surroundings. They must not
   * be presented to the planner as one kind of statement.
   */
  kind: "use" | "status" | "context";
  label: string;
  source_url: string;
  licence: string;
  attribution: string;
};
export type EvidenceStatus = {
  ready: boolean;
  metadata: Record<string, string>;
  pbfChecksum: string;
  sources: EvidenceSource[];
};

async function responseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(
      data.error ?? `Evidence request failed (${response.status}).`,
    ) as Error & { code?: string };
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function evidenceStatus(signal?: AbortSignal): Promise<EvidenceStatus> {
  const response = await fetch(`${BASE}/status`, { signal });
  return responseJson(response);
}

export async function viewportEvidence(
  bbox: [number, number, number, number],
  source?: string,
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const query = new URLSearchParams({ bbox: bbox.join(",") });
  if (source) query.set("source", source);
  const response = await fetch(`${BASE}/evidence/sections?${query}`, { signal });
  return responseJson(response);
}

/**
 * One route as index ranges into its own shape. The service already holds the
 * way geometry, so sending each edge's coordinates again was the largest body
 * on the wire; the shape travels once as its encoded polyline instead.
 */
function routeRequest(route: RouteResult, edges: RouteEdge[]) {
  return {
    encodedPolyline: route.encodedShape ?? encodePolyline(route.geometry),
    edges: edges.map((edge) => ({
      wayId: edge.attributes.wayId,
      beginIndex: edge.beginIndex,
      endIndex: edge.endIndex,
    })),
  };
}

type SourceBreakdown = Record<string, { evidencedFraction: number }>;

function shares(bySource?: SourceBreakdown): Record<string, number> | undefined {
  if (!bySource) return undefined;
  return Object.fromEntries(
    Object.entries(bySource).map(([source, value]) => [
      source,
      value.evidencedFraction,
    ]),
  );
}

export async function routeUseEvidence(
  route: RouteResult,
  edges: RouteEdge[],
  includeSegments = true,
  signal?: AbortSignal,
  breakdown = false,
): Promise<RouteUseEvidence> {
  try {
    const response = await fetch(`${BASE}/route-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...routeRequest(route, edges),
        includeSegments,
        breakdown,
      }),
      signal,
    });
    const data = await responseJson<{
      evidencedDistanceM: number;
      evidencedFraction: number;
      bySource?: SourceBreakdown;
      segments?: GeoJSON.FeatureCollection;
    }>(response);
    return {
      status: "available",
      evidencedDistanceKm: data.evidencedDistanceM / 1000,
      evidencedDistancePct: data.evidencedFraction * 100,
      bySource: shares(data.bySource),
      segments: data.segments,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return {
      status: "unavailable",
      evidencedDistanceKm: 0,
      evidencedDistancePct: 0,
    };
  }
}

type BatchRoute = { id: string; route: RouteResult; edges: RouteEdge[] };

export async function routeUseEvidenceBatch(
  routes: BatchRoute[],
  signal?: AbortSignal,
): Promise<Map<string, RouteUseEvidence>> {
  const unavailable = () =>
    ({
      status: "unavailable",
      evidencedDistanceKm: 0,
      evidencedDistancePct: 0,
    }) satisfies RouteUseEvidence;
  try {
    const response = await fetch(`${BASE}/route-evidence/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        includeSegments: false,
        breakdown: true,
        routes: routes.map(({ id, route, edges }) => ({
          id,
          ...routeRequest(route, edges),
        })),
      }),
      signal,
    });
    const data = await responseJson<{
      routes: Array<{
        id: string;
        evidencedDistanceM: number;
        evidencedFraction: number;
        bySource?: SourceBreakdown;
      }>;
    }>(response);
    return new Map(
      data.routes.map((result) => [
        result.id,
        {
          status: "available" as const,
          evidencedDistanceKm: result.evidencedDistanceM / 1000,
          evidencedDistancePct: result.evidencedFraction * 100,
          bySource: shares(result.bySource),
        },
      ]),
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return new Map(routes.map(({ id }) => [id, unavailable()]));
  }
}
