import type { Coordinate } from '@/domain/models';

export type RouteThumbnailProps = {
  /** The route line, already sampled down to a card's worth of points. */
  outline: Coordinate[];
  accent: string;
  size?: number;
};
