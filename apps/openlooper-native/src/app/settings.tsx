import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import {
  distanceUnit,
  elevationUnit,
  formatDistance,
  formatElevation,
  formatSpeed,
  shortDistanceUnit,
  speedUnit,
  UNIT_SYSTEMS,
} from '../../../../src/domain/units';
import { IconButton } from '@/components/ui/icon-button';
import { Segmented } from '@/components/ui/segmented';
import { useSettings } from '@/state/settings-context';

/** A distance, a climb and a speed worth reading the choice against. */
const SAMPLE = { km: 12.4, ascentM: 180, speedKph: 11 };

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { units, setUnits } = useSettings();

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <IconButton
          symbol="chevron.left"
          fallbackLabel="Back"
          accessibilityLabel="Back to routes"
          accent={COLOR.ink}
          size={44}
          onPress={() => router.back()}
        />
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Measurements</Text>
          <Text style={styles.hint}>
            How distances, climbs and speeds are shown. Routes are stored the same way whichever
            you choose, so switching never changes a saved route.
          </Text>
          <Segmented
            accessibilityLabel="Measurement system"
            values={UNIT_SYSTEMS}
            selected={units}
            accent={COLOR.start}
            onChange={setUnits}
          />
          <View style={styles.samples}>
            <Sample label="Distance" value={formatDistance(SAMPLE.km, units)} />
            <Sample label="Climb" value={`${formatElevation(SAMPLE.ascentM, units)} ↑`} />
            <Sample label="Speed" value={formatSpeed(SAMPLE.speedKph, units)} />
          </View>
          <Text style={styles.disclaimer}>
            Long distances in {distanceUnit(units)}, short ones in {shortDistanceUnit(units)},
            climbs in {elevationUnit(units)}, speeds in {speedUnit(units)}.
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.hint}>
            OpenLooper is experimental pre-production software. It is not a safety tool or a
            navigation service. Route notes come from recorded map data and are never a guarantee
            of surface, traffic, lighting or current conditions.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Sample({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sample}>
      <Text style={styles.sampleLabel}>{label}</Text>
      <Text style={styles.sampleValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.surface },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  title: { color: COLOR.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  content: { paddingHorizontal: 18, paddingTop: 6, gap: 12 },
  panel: {
    gap: 10,
    padding: 14,
    borderRadius: RADIUS.panel,
    backgroundColor: COLOR.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.line,
  },
  sectionTitle: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  hint: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },
  disclaimer: { color: COLOR.faint, fontSize: 11, lineHeight: 16 },
  samples: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sample: {
    minWidth: '30%',
    flexGrow: 1,
    gap: 2,
    padding: 10,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.raised,
    ...SHADOW.floating,
    shadowOpacity: 0.06,
  },
  sampleLabel: { color: COLOR.muted, fontSize: 11 },
  sampleValue: { color: COLOR.ink, fontSize: 16, fontWeight: '900' },
});
