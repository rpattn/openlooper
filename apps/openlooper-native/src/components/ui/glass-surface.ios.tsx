import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';

import { COLOR } from '@/theme';
import type { GlassSurfaceProps } from './types';

// `isLiquidGlassAvailable()` is false on iOS 18 and below, and when the system
// falls back for Reduce Transparency, so the opaque card stays the safety net.
const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * A floating control's surface.
 *
 * The glass goes over a light veil rather than straight over the map. Left to
 * itself the material takes its opacity from whatever it happens to be sampling,
 * so the same control read as a solid disc over a park and as nothing at all
 * over a street. The veil sets a floor: every control keeps the same weight
 * wherever it lands, and the glass still supplies the depth and the edge.
 */
export function GlassSurface({
  children,
  style,
  variant = 'regular',
  tint,
  pointerEvents,
}: GlassSurfaceProps) {
  if (!LIQUID_GLASS) {
    return (
      <View
        pointerEvents={pointerEvents}
        style={[variant === 'clear' ? styles.clear : styles.regular, style]}
      >
        {children}
      </View>
    );
  }
  return (
    <View
      pointerEvents={pointerEvents}
      style={[variant === 'clear' ? styles.veilClear : styles.veil, style]}
    >
      <GlassView
        pointerEvents="none"
        glassEffectStyle={variant}
        tintColor={tint}
        colorScheme="light"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  regular: { backgroundColor: 'rgba(250,251,247,0.97)' },
  clear: { backgroundColor: 'rgba(250,251,247,0.82)', borderWidth: 1, borderColor: COLOR.line },
  // Callers already clip to their own radius, which is what keeps the glass
  // layer inside the rounded shape.
  veil: { backgroundColor: 'rgba(250,251,247,0.58)' },
  veilClear: { backgroundColor: 'rgba(250,251,247,0.24)' },
});
