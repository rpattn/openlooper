import { COLOR } from '@/theme';
import type { WaypointRole } from '@/domain/models';

export function roleColor(role: WaypointRole): string {
  if (role === 'start') return COLOR.start;
  if (role === 'destination') return COLOR.finish;
  return COLOR.via;
}
