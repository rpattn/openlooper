import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import type { SavedRouteSummary } from '@/domain/saved-route';
import { SmallButton } from './ui/buttons';
import { RouteThumbnail } from './ui/route-thumbnail';

export type RouteCardProps = {
  route: SavedRouteSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** One saved route in the home list: its shape, its numbers, and the two ways
 * of opening it. */
export function RouteCard({ route, onOpen, onEdit, onDelete }: RouteCardProps) {
  const [confirming, setConfirming] = useState(false);
  const accent = ACTIVITY[route.activity].color;
  const mode = CREATION_MODES.find((item) => item.value === route.mode)?.label ?? route.mode;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${route.name}`}
        onPress={onOpen}
        style={styles.row}
      >
        <RouteThumbnail outline={route.outline} accent={accent} size={92} />
        <View style={styles.detail}>
          <Text style={styles.eyebrow}>
            {ACTIVITY[route.activity].label.toUpperCase()} · {mode.toUpperCase()}
          </Text>
          <Text style={styles.name} numberOfLines={2}>
            {route.name}
          </Text>
          <Text style={styles.metrics}>
            {route.distanceKm.toFixed(1)} km · {duration(route.durationSeconds)}
          </Text>
          <Text style={styles.sub}>
            {route.ascentM === undefined
              ? 'Elevation unavailable'
              : `≈ ${route.ascentM} m ↑ · ${route.descentM} m ↓`}
          </Text>
          <Text style={styles.sub}>Saved {savedOn(route.updatedAt)}</Text>
        </View>
      </Pressable>
      {confirming ? (
        <View style={styles.actions}>
          <Text style={styles.confirm}>Delete this route?</Text>
          <SmallButton label="Keep" onPress={() => setConfirming(false)} />
          <SmallButton label="Delete" onPress={onDelete} dark />
        </View>
      ) : (
        <View style={styles.actions}>
          <SmallButton label="Delete" onPress={() => setConfirming(true)} />
          <View style={styles.spacer} />
          <SmallButton label="View" onPress={onOpen} />
          <SmallButton label="Edit" onPress={onEdit} dark />
        </View>
      )}
    </View>
  );
}

const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
};

const savedOn = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 12,
    borderRadius: RADIUS.panel,
    backgroundColor: COLOR.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
  },
  row: { flexDirection: 'row', gap: 12 },
  detail: { flex: 1, gap: 1 },
  eyebrow: { color: COLOR.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  name: { color: COLOR.ink, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  metrics: { marginTop: 2, color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  sub: { color: COLOR.muted, fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spacer: { flex: 1 },
  confirm: { flex: 1, color: COLOR.ink, fontSize: 12, fontWeight: '700' },
});
