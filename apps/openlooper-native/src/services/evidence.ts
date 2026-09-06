import type { RouteEdge, RouteResult, RouteUseEvidence } from '../../../../src/domain/models';
import { EVIDENCE_URL as BASE } from './endpoints';

function edgeRequest(route: RouteResult, edge: RouteEdge) {
  return {
    wayId: edge.attributes.wayId,
    coordinates: route.geometry
      .slice(edge.beginIndex, edge.endIndex + 1)
      .map((point) => [point.lon, point.lat]),
  };
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
        edges: edges.map((edge) => edgeRequest(route, edge)),
        // Segments carry the way ids the recorded-use colouring needs. Only the
        // selected route asks for them; ranking many candidates does not.
        includeSegments: true,
      }),
      signal,
    });
    if (!response.ok) return unavailable();
    const data = (await response.json()) as {
      evidencedDistanceM: number;
      evidencedFraction: number;
      segments?: GeoJSON.FeatureCollection;
    };
    return {
      status: 'available',
      evidencedDistanceKm: data.evidencedDistanceM / 1000,
      evidencedDistancePct: data.evidencedFraction * 100,
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
        routes: routes.map(({ id, route, edges }) => ({
          id,
          edges: edges.map((edge) => edgeRequest(route, edge)),
        })),
      }),
      signal,
    });
    if (!response.ok) throw new Error('Evidence unavailable');
    const data = (await response.json()) as {
      routes: Array<{ id: string; evidencedDistanceM: number; evidencedFraction: number }>;
    };
    return new Map(
      data.routes.map((result) => [
        result.id,
        {
          status: 'available' as const,
          evidencedDistanceKm: result.evidencedDistanceM / 1000,
          evidencedDistancePct: result.evidencedFraction * 100,
        },
      ]),
    );
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return new Map(routes.map(({ id }) => [id, unavailable()]));
  }
}
