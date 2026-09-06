import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';

import { COLOR } from '@/theme';
import type { GlassSurfaceProps } from './types';

// `isLiquidGlassAvailable()` is false on iOS 18 and below, and when the system
// falls back for Reduce Transparency, so the opaque card stays the safety net.
const LIQUID_GLASS = isLiquidGlassAvailable();

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
    <GlassView
      pointerEvents={pointerEvents}
      glassEffectStyle={variant}
      tintColor={tint}
      colorScheme="light"
      style={style}
    >
      {children}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  regular: { backgroundColor: 'rgba(250,251,247,0.97)' },
  clear: { backgroundColor: 'rgba(250,251,247,0.82)', borderWidth: 1, borderColor: COLOR.line },
});
