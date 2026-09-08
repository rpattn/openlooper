import type { RouteEdge, RouteResult, RouteUseEvidence } from '../../../../src/domain/models';
import { encodePolyline } from '../../../../src/routing/valhalla-mapper';
import { EVIDENCE_URL as BASE } from './endpoints';

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
    Object.entries(bySource).map(([source, value]) => [source, value.evidencedFraction]),
  );
}

const unavailable = () => ({
  status: 'unavailable' as const,
  evidencedDistanceKm: 0,
  evidencedDistancePct: 0,
});

export async function routeEvidence(
  route: RouteResult,
  edges: RouteEdge[],
  signal?: AbortSignal,
): Promise<RouteUseEvidence> {
  try {
    const response = await fetch(`${BASE}/route-evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...routeRequest(route, edges),
        // Segments carry the way ids the recorded-use colouring needs. Only the
        // selected route asks for them; ranking many candidates does not.
        includeSegments: true,
        breakdown: true,
      }),
      signal,
    });
    if (!response.ok) return unavailable();
    const data = (await response.json()) as {
      evidencedDistanceM: number;
      evidencedFraction: number;
      bySource?: SourceBreakdown;
      segments?: GeoJSON.FeatureCollection;
    };
    return {
      status: 'available',
      evidencedDistanceKm: data.evidencedDistanceM / 1000,
      evidencedDistancePct: data.evidencedFraction * 100,
      bySource: shares(data.bySource),
      segments: data.segments,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return unavailable();
  }
}

export async function routeEvidenceBatch(
  routes: Array<{ id: string; route: RouteResult; edges: RouteEdge[] }>,
  signal?: AbortSignal,
): Promise<Map<string, RouteUseEvidence>> {
  try {
    const response = await fetch(`${BASE}/route-evidence/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    if (!response.ok) throw new Error('Evidence unavailable');
    const data = (await response.json()) as {
      routes: Array<{
        id: string;
        evidencedDistanceM: number;
        evidencedFraction: number;
        bySource?: SourceBreakdown;
      }>;
    };
    return new Map(
      data.routes.map((result) => [
        result.id,
        {
          status: 'available' as const,
          evidencedDistanceKm: result.evidencedDistanceM / 1000,
          evidencedDistancePct: result.evidencedFraction * 100,
          bySource: shares(result.bySource),
        },
      ]),
    );
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return new Map(routes.map(({ id }) => [id, unavailable()]));
  }
}

/**
 * Recorded use for everything in view, rather than for one computed route. This
 * is what makes the evidence usable while a route is still being drawn: the
 * roads people are recorded on can be seen before anything is planned through
 * them.
 */
export async function viewportEvidence(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const query = new URLSearchParams({ bbox: bbox.join(',') });
  const response = await fetch(`${BASE}/evidence/sections?${query}`, { signal });
  const data = (await response.json().catch(() => ({}))) as GeoJSON.FeatureCollection & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(data.error ?? `Evidence request failed (${response.status}).`) as Error & {
      code?: string;
    };
    error.code = data.code;
    throw error;
  }
  return data;
}
