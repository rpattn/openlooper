import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import type { Activity, CreationMode, InteractionMode } from '@/domain/models';
import type { SavedRoutePage } from '@/domain/saved-route';
import { formatDistance } from '../../../../src/domain/units';
import { useUnits } from '@/state/settings-context';
import { RouteCard } from './route-card';
import { PrimaryButton, SmallButton } from './ui/buttons';
import { IconButton } from './ui/icon-button';
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
  onSettings: () => void;
};

/**
 * Landing screen. It sits over the live map rather than replacing it, so
 * starting a route slides this page away to uncover the map already in place.
 *
 * The layout is fixed in three bands: a masthead at the top, saved routes
 * scrolling in the middle, and the create dock pinned to the bottom. Saving a
 * route therefore lengthens the list without ever pushing the primary action
 * up out of thumb reach.
 */
export function HomeScreen(props: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const accent = ACTIVITY[props.activity].color;
  const page = props.page;
  const total = page?.total ?? 0;
  const first = props.pageIndex * props.pageSize;
  const pages = Math.max(1, Math.ceil(total / props.pageSize));

  return (
    <View style={styles.root}>
      <View style={styles.scrim} pointerEvents="none" />
      <View style={[styles.column, { paddingTop: insets.top + 14 }]}>
        <View style={styles.masthead}>
          <View style={styles.mastheadText}>
            <Text style={styles.brand}>OPENLOOPER</Text>
            <Text style={styles.title}>Make a route worth taking</Text>
          </View>
          <IconButton
            symbol="gearshape.fill"
            fallbackLabel="⚙"
            accessibilityLabel="Settings"
            accent={COLOR.ink}
            size={44}
            onPress={props.onSettings}
          />
        </View>

        <View style={styles.listBand}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeading}>Saved routes</Text>
            <Text style={styles.stats}>
              {total
                ? `${total} saved · ${formatDistance(page?.totalDistanceKm ?? 0, units, 0)}`
                : props.loading
                  ? 'Loading…'
                  : 'None yet'}
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!!props.error && (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{props.error}</Text>
              </View>
            )}

            {!props.loading && !total && !props.error && (
              <View style={styles.empty}>
                <Text style={styles.hint}>
                  Routes you save from the map appear here, on this device only. Nothing is
                  uploaded.
                </Text>
              </View>
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

        <View style={[styles.dock, { paddingBottom: insets.bottom + 14 }]}>
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
          <View style={styles.dockRow}>
            <View style={styles.grow}>
              <Segmented
                accessibilityLabel="Route type"
                values={CREATION_MODES}
                selected={props.mode}
                accent={accent}
                onChange={props.onMode}
              />
            </View>
            {props.mode === 'loop' && (
              <DistanceField value={props.targetKm} onChange={props.onTarget} />
            )}
          </View>
          <PrimaryButton label="Create route" accent={accent} onPress={props.onCreate} />
          {!!props.onResume && (
            <SmallButton label="Continue unsaved route" onPress={props.onResume} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // The map stays visible through the page, so sliding it away reads as
  // uncovering the map rather than loading a new screen.
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(244,247,241,0.84)',
  },
  // Wide screens read the page as a column rather than stretching every card.
  column: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },

  masthead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  mastheadText: { flex: 1 },
  brand: { color: COLOR.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: COLOR.ink, fontSize: 25, fontWeight: '900', letterSpacing: -0.7 },

  listBand: { flex: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  sectionHeading: { color: COLOR.ink, fontSize: 17, fontWeight: '900', letterSpacing: -0.3 },
  stats: { color: COLOR.muted, fontSize: 12, fontWeight: '700' },
  listContent: { gap: 10, paddingHorizontal: 18, paddingBottom: 14 },

  empty: {
    padding: 14,
    borderRadius: RADIUS.panel,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
  },
  hint: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },
  notice: { padding: 11, borderRadius: 11, backgroundColor: '#f9e3df' },
  noticeText: { color: COLOR.ink, fontSize: 12 },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageLabel: { color: COLOR.muted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Pinned, so the list can grow without moving the primary action.
  dock: {
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    backgroundColor: COLOR.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLOR.line,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    ...SHADOW.sheet,
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
});
