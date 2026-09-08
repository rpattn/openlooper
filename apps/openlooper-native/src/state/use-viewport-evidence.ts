import { useEffect, useRef, useState } from 'react';

import type { ViewportEvidenceState } from '@/domain/models';
import { viewportEvidence } from '@/services/evidence';

/** The visible extent, west, south, east, north. */
export type Bounds = [number, number, number, number];

/** Long enough that panning across a town is one request rather than twenty. */
const SETTLE_MS = 450;

export type ViewportEvidence = {
  sections?: GeoJSON.FeatureCollection;
  status: ViewportEvidenceState;
};

const IDLE: ViewportEvidenceState = { loading: false, count: 0 };

/**
 * Recorded use for whatever is on screen, kept in step with the map as it moves.
 * The planner reads this before a route exists, which is the point of it: the
 * roads people actually use are worth seeing while choosing where to go, not
 * only as a colouring of a route already chosen.
 */
export function useViewportEvidence(enabled: boolean, bounds?: Bounds): ViewportEvidence {
  const [sections, setSections] = useState<GeoJSON.FeatureCollection>();
  const [status, setStatus] = useState<ViewportEvidenceState>(IDLE);
  const abort = useRef<AbortController | undefined>(undefined);
  const count = useRef(0);
  const key = bounds?.map((value) => value.toFixed(3)).join(',');

  useEffect(() => {
    if (!enabled) {
      abort.current?.abort();
      count.current = 0;
      setSections(undefined);
      setStatus(IDLE);
      return;
    }
    if (!bounds) return;
    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setStatus({ loading: true, count: count.current });
      void viewportEvidence(bounds, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          count.current = data.features.length;
          setSections(data);
          setStatus({ loading: false, count: data.features.length });
        })
        .catch((error: Error & { code?: string }) => {
          if (controller.signal.aborted || error.name === 'AbortError') return;
          // A failed refresh leaves the sections already on screen alone: stale
          // evidence for a neighbouring view is more use than a blank map.
          setStatus({
            loading: false,
            count: count.current,
            error:
              error.code === 'viewport_too_broad'
                ? 'Zoom in to load recorded use.'
                : 'Recorded use could not be refreshed.',
          });
        });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // Refetching is driven by the rounded extent, so a pixel of drift while the
    // map settles does not start a request of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  useEffect(() => () => abort.current?.abort(), []);

  return { sections, status };
}
