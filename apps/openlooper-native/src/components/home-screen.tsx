import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, RADIUS } from '@/theme';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import type { Activity, CreationMode, InteractionMode } from '@/domain/models';
import type { SavedRoutePage } from '@/domain/saved-route';
import { RouteCard } from './route-card';
import { GlassSurface } from './ui/glass-surface';
import { PrimaryButton, SmallButton } from './ui/buttons';
import { DistanceField } from './ui/distance-field';
import { Segmented } from './ui/segmented';

export type HomeScreenProps = {
  activity: Activity;
  mode: CreationMode;
  targetKm: number;
  onActivity: (activity: Activity) => void;
  onMode: (mode: CreationMode) => void;
  onTarget: (km: number) => void;
  onCreate: () => void;
  /** Offered only while an unsaved route from a previous run is still loaded. */
  onResume?: () => void;
  page?: SavedRoutePage;
  pageIndex: number;
  pageSize: number;
  loading: boolean;
  error?: string;
  onPage: (index: number) => void;
  onOpen: (id: string, interaction: InteractionMode) => void;
  onDelete: (id: string) => void;
};

/**
 * Landing screen. It sits over the live map rather than replacing it, so
 * starting a route slides this page away to reveal the map already in place.
 */
export function HomeScreen(props: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const accent = ACTIVITY[props.activity].color;
  const page = props.page;
  const total = page?.total ?? 0;
  const first = props.pageIndex * props.pageSize;
  const pages = Math.max(1, Math.ceil(total / props.pageSize));

  return (
    <View style={styles.root}>
      <View style={styles.scrim} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>OPENLOOPER</Text>
          <Text style={styles.title}>Make a route worth taking</Text>
        </View>

        <GlassSurface variant="regular" style={styles.panel}>
          <Text style={styles.sectionTitle}>New route</Text>
          <Segmented
            accessibilityLabel="Activity"
            values={(Object.keys(ACTIVITY) as Activity[]).map((value) => ({
              value,
              label: ACTIVITY[value].label,
            }))}
            selected={props.activity}
            accent={accent}
            onChange={props.onActivity}
          />
          <Segmented
            accessibilityLabel="Route type"
            values={CREATION_MODES}
            selected={props.mode}
            accent={accent}
            onChange={props.onMode}
          />
          {props.mode === 'loop' && (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Target distance</Text>
              <DistanceField value={props.targetKm} onChange={props.onTarget} />
            </View>
          )}
          <Text style={styles.hint}>{modeHint(props.mode)}</Text>
          <PrimaryButton label="Create route" accent={accent} onPress={props.onCreate} />
          {!!props.onResume && (
            <SmallButton label="Continue unsaved route" onPress={props.onResume} />
          )}
        </GlassSurface>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeading}>Saved routes</Text>
          <Text style={styles.stats}>
            {total
              ? `${total} saved · ${(page?.totalDistanceKm ?? 0).toFixed(0)} km`
              : props.loading
                ? 'Loading…'
                : 'None yet'}
          </Text>
        </View>

        {!!props.error && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{props.error}</Text>
          </View>
        )}

        {!props.loading && !total && !props.error && (
          <GlassSurface variant="clear" style={styles.empty}>
            <Text style={styles.hint}>
              Routes you save from the map appear here, on this device only. Nothing is uploaded.
            </Text>
          </GlassSurface>
        )}

        {page?.items.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            onOpen={() => props.onOpen(route.id, 'inspect')}
            onEdit={() => props.onOpen(route.id, 'edit')}
            onDelete={() => props.onDelete(route.id)}
          />
        ))}

        {total > props.pageSize && (
          <View style={styles.pager}>
            <SmallButton
              label="‹ Newer"
              disabled={props.pageIndex === 0}
              onPress={() => props.onPage(props.pageIndex - 1)}
            />
            <Text style={styles.pageLabel}>
              {first + 1}–{Math.min(first + props.pageSize, total)} of {total}
            </Text>
            <SmallButton
              label="Older ›"
              disabled={props.pageIndex >= pages - 1}
              onPress={() => props.onPage(props.pageIndex + 1)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function modeHint(mode: CreationMode) {
  if (mode === 'loop')
    return 'Pick a start on the map, then generate up to three distinct loops near your target distance.';
  if (mode === 'sketch') return 'Tap along the map to sketch a shape; each leg is routed for you.';
  return 'Place a start and a finish on the map, then compare the alternatives.';
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // The map stays visible through the page, so sliding it away reads as
  // uncovering the map rather than loading a new screen.
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(244,247,241,0.82)' },
  // Wide screens read the list as a column rather than stretching every card.
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, gap: 12 },
  header: { gap: 2, paddingBottom: 2 },
  brand: { color: COLOR.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: COLOR.ink, fontSize: 26, fontWeight: '900', letterSpacing: -0.8 },

  panel: {
    gap: 10,
    padding: 14,
    borderRadius: RADIUS.panel,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
  },
  sectionTitle: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  hint: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  sectionHeading: { color: COLOR.ink, fontSize: 18, fontWeight: '900', letterSpacing: -0.4 },
  stats: { color: COLOR.muted, fontSize: 12, fontWeight: '700' },

  empty: { padding: 14, borderRadius: RADIUS.panel, overflow: 'hidden' },
  notice: { padding: 11, borderRadius: 11, backgroundColor: '#f9e3df' },
  noticeText: { color: COLOR.ink, fontSize: 12 },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageLabel: { color: COLOR.muted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
