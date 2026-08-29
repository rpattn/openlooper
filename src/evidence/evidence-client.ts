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
  };
  if (!response.ok) throw new Error(data.error ?? `Evidence request failed (${response.status}).`);
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
  signal?: AbortSignal,
): Promise<RouteUseEvidence> {
  try {
    const response = await fetch(`${BASE}/route-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edges: edges.map((edge) => edgeRequest(route, edge)) }),
      signal,
    });
    const data = await responseJson<{
      evidencedDistanceM: number;
      evidencedFraction: number;
      segments: GeoJSON.FeatureCollection;
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
