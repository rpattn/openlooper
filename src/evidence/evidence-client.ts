import type { RouteEdge, RouteResult, RouteUseEvidence } from "../domain/models";

const BASE = import.meta.env.VITE_EVIDENCE_URL ?? "/api/evidence";

export type EvidenceSource = {
  source_id: string;
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

function edgeRequest(route: RouteResult, edge: RouteEdge) {
  return {
    wayId: edge.attributes.wayId,
    coordinates: route.geometry
      .slice(edge.beginIndex, edge.endIndex + 1)
      .map((point) => [point.lon, point.lat]),
  };
}

export async function routeUseEvidence(
  route: RouteResult,
  edges: RouteEdge[],
  includeSegments = true,
  signal?: AbortSignal,
): Promise<RouteUseEvidence> {
  try {
    const response = await fetch(`${BASE}/route-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edges: edges.map((edge) => edgeRequest(route, edge)),
        includeSegments,
      }),
      signal,
    });
    const data = await responseJson<{
      evidencedDistanceM: number;
      evidencedFraction: number;
      segments?: GeoJSON.FeatureCollection;
    }>(response);
    return {
      status: "available",
      evidencedDistanceKm: data.evidencedDistanceM / 1000,
      evidencedDistancePct: data.evidencedFraction * 100,
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
        routes: routes.map(({ id, route, edges }) => ({
          id,
          edges: edges.map((edge) => edgeRequest(route, edge)),
        })),
      }),
      signal,
    });
    const data = await responseJson<{
      routes: Array<{
        id: string;
        evidencedDistanceM: number;
        evidencedFraction: number;
      }>;
    }>(response);
    return new Map(
      data.routes.map((result) => [
        result.id,
        {
          status: "available" as const,
          evidencedDistanceKm: result.evidencedDistanceM / 1000,
          evidencedDistancePct: result.evidencedFraction * 100,
        },
      ]),
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return new Map(routes.map(({ id }) => [id, unavailable()]));
  }
}
