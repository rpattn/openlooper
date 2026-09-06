import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';
import type { Coordinate } from '@/domain/models';
import type { RouteThumbnailProps } from './route-thumbnail.types';

const STROKE = 2.5;
const PADDING = 9;

/**
 * Card-sized picture of a route line, for the web build. Each segment is a
 * rotated bar, which draws the shape with plain views rather than pulling in an
 * SVG renderer — the same trade the profile chart makes.
 *
 * The native card shows a real map instead. A MapLibre instance per card would
 * mean a WebGL context per card, and browsers cap how many a page may hold.
 */
export function RouteThumbnail({ outline, accent, size = 92 }: RouteThumbnailProps) {
  const segments = useMemo(() => project(outline, size), [outline, size]);
  return (
    <View style={[styles.tile, { width: size, height: size }]}>
      {segments.map((segment, index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left: segment.x - segment.length / 2,
            top: segment.y - STROKE / 2,
            width: segment.length,
            height: STROKE,
            borderRadius: STROKE / 2,
            backgroundColor: accent,
            transform: [{ rotate: `${segment.angle}rad` }],
          }}
        />
      ))}
      {!!segments.length && (
        <View
          style={[
            styles.start,
            { left: segments[0]!.startX - 4, top: segments[0]!.startY - 4, borderColor: accent },
          ]}
        />
      )}
    </View>
  );
}

type Segment = {
  x: number;
  y: number;
  length: number;
  angle: number;
  startX: number;
  startY: number;
};

/**
 * Fits the line into the tile. Longitude is scaled by the cosine of the middle
 * latitude so the shape keeps the proportions it has on the map rather than
 * being stretched east-west.
 */
function project(outline: Coordinate[], size: number): Segment[] {
  if (outline.length < 2) return [];
  const lats = outline.map((point) => point.lat);
  const lons = outline.map((point) => point.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const scaleLon = Math.cos((midLat * Math.PI) / 180);
  const xs = lons.map((lon) => lon * scaleLon);
  const minX = Math.min(...xs);
  const minY = Math.min(...lats);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...lats) - minY;
  const box = size - PADDING * 2;
  // A dead-straight out-and-back has no span on one axis; the larger span sets
  // the scale for both so it stays a line instead of dividing by zero.
  const scale = box / Math.max(spanX, spanY, 1e-9);
  const offsetX = PADDING + (box - spanX * scale) / 2;
  const offsetY = PADDING + (box - spanY * scale) / 2;
  const points = outline.map((point, index) => ({
    x: offsetX + (xs[index]! - minX) * scale,
    // Latitude grows northwards and screen y grows downwards.
    y: offsetY + (spanY - (point.lat - minY)) * scale,
  }));
  const segments: Segment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    segments.push({
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      // Overlap by a stroke width so the joins between bars do not show.
      length: length + STROKE,
      angle: Math.atan2(dy, dx),
      startX: points[0]!.x,
      startY: points[0]!.y,
    });
  }
  return segments;
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
    backgroundColor: '#e6ebe3',
  },
  start: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: '#fff',
  },
});
