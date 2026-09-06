import type { Coordinate } from './models';

const EQUATOR_METRES_PER_PIXEL = 156543.03392;
const METRES_PER_DEGREE_LATITUDE = 111320;

/**
 * Shifts a camera centre south so the point of interest lands in the middle of
 * the map still visible above the sheet, rather than behind it.
 */
export function centreAbove(
  coordinate: Coordinate,
  zoom: number,
  obscuredHeight: number,
): Coordinate {
  if (obscuredHeight <= 0) return coordinate;
  const metresPerPixel =
    (EQUATOR_METRES_PER_PIXEL * Math.cos((coordinate.lat * Math.PI) / 180)) / 2 ** zoom;
  const degreesPerPixel = metresPerPixel / METRES_PER_DEGREE_LATITUDE;
  return {
    lat: coordinate.lat - degreesPerPixel * (obscuredHeight / 2),
    lon: coordinate.lon,
  };
}
