import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';
import { roleColor } from './waypoint-role';
import type { WaypointListProps } from './types';

/**
 * Android/web stand-in for the iOS drag-to-reorder list. Reordering is exposed
 * as explicit up/down buttons so it stays usable without a drag affordance.
 */
export function WaypointList({ rows, accent, editable, onMove, onDelete, onSelect }: WaypointListProps) {
  const movable = rows.filter((row) => !row.locked).length;
  return (
    <View style={styles.list}>
      {rows.map((row, index) => (
        <Pressable key={row.id} onPress={() => onSelect(row.id)} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: roleColor(row.role) }]}>
            <Text style={styles.dotText}>{row.marker}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.title}>{row.title}</Text>
            <Text style={styles.subtitle}>
              {row.legLabel ? `${row.legLabel} from previous` : row.subtitle}
            </Text>
          </View>
          {editable && !row.locked && (
            <View style={styles.actions}>
              <Step
                label="↑"
                accent={accent}
                hint={`Move ${row.title} earlier`}
                disabled={index === 0 || rows[index - 1]!.locked}
                onPress={() => onMove(index, index - 1)}
              />
              <Step
                label="↓"
                accent={accent}
                hint={`Move ${row.title} later`}
                disabled={index >= rows.length - 1 || rows[index + 1]!.locked}
                onPress={() => onMove(index, index + 1)}
              />
              <Step
                label="✕"
                accent={COLOR.danger}
                hint={`Remove ${row.title}`}
                disabled={movable <= 1}
                onPress={() => onDelete(index)}
              />
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function Step({
  label,
  hint,
  accent,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  accent: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, disabled && styles.stepDisabled]}
    >
      <Text style={[styles.stepText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.raised,
  },
  dot: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  dotText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  grow: { flex: 1 },
  title: { color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  subtitle: { color: COLOR.muted, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 4 },
  step: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: COLOR.panel,
  },
  stepDisabled: { opacity: 0.3 },
  stepText: { fontSize: 14, fontWeight: '900' },
});
