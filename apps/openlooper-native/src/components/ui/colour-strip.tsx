import { StyleSheet, View } from 'react-native';

import { COLOR } from '@/theme';
import type { ColourSpan } from '../../../../../src/domain/route-overlays';

/**
 * The route's colouring laid out along the same distance axis as the chart
 * above it, so a colour on the map can be found on the profile.
 */
export function ColourStrip({ spans, totalKm }: { spans: ColourSpan[]; totalKm: number }) {
  if (!spans.length || totalKm <= 0) return null;
  return (
    <View style={styles.strip} accessibilityLabel="Route colouring along the distance">
      {spans.map((span, index) => (
        <View
          key={`${index}-${span.startKm}`}
          style={{
            flexGrow: Math.max(0.0001, span.endKm - span.startKm),
            flexBasis: 0,
            backgroundColor: span.color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 8,
    flexDirection: 'row',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: COLOR.field,
  },
});
