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

/** One saved route: its shape on the map, its numbers, and the two ways of
 * opening it. Kept short so a scroll band shows several at once. */
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
      >
        <RouteThumbnail outline={route.outline} accent={accent} size={84} />
      </Pressable>
      <View style={styles.detail}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {ACTIVITY[route.activity].label.toUpperCase()} · {mode.toUpperCase()} ·{' '}
          {savedOn(route.updatedAt).toUpperCase()}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${route.name}`} onPress={onOpen}>
          <Text style={styles.name} numberOfLines={1}>
            {route.name}
          </Text>
        </Pressable>
        <Text style={styles.metrics} numberOfLines={1}>
          {route.distanceKm.toFixed(1)} km · {duration(route.durationSeconds)}
          {route.ascentM === undefined ? '' : ` · ${route.ascentM} m ↑`}
        </Text>
        {confirming ? (
          <View style={styles.actions}>
            <Text style={styles.confirm}>Delete?</Text>
            <SmallButton label="Keep" onPress={() => setConfirming(false)} />
            <SmallButton label="Delete" onPress={onDelete} dark />
          </View>
        ) : (
          <View style={styles.actions}>
            <SmallButton label="View" onPress={onOpen} />
            <SmallButton label="Edit" onPress={onEdit} dark />
            <View style={styles.spacer} />
            <SmallButton label="Delete" onPress={() => setConfirming(true)} />
          </View>
        )}
      </View>
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
    flexDirection: 'row',
    gap: 12,
    padding: 11,
    borderRadius: RADIUS.panel,
    backgroundColor: COLOR.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
  },
  detail: { flex: 1, gap: 1 },
  eyebrow: { color: COLOR.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  name: { color: COLOR.ink, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  metrics: { color: COLOR.ink, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  spacer: { flex: 1 },
  confirm: { color: COLOR.ink, fontSize: 12, fontWeight: '800' },
});
