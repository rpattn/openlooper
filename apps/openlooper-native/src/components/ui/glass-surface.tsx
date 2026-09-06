import { StyleSheet, View } from 'react-native';

import { COLOR } from '@/theme';
import type { GlassSurfaceProps } from './types';

/**
 * Solid stand-in for the iOS liquid-glass surface. Android and web get an
 * opaque card so text keeps its contrast without a backdrop blur.
 */
export function GlassSurface({
  children,
  style,
  variant = 'regular',
  tint,
  pointerEvents,
}: GlassSurfaceProps) {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        variant === 'clear' ? styles.clear : styles.regular,
        tint ? { backgroundColor: tint } : undefined,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  regular: { backgroundColor: 'rgba(250,251,247,0.97)' },
  clear: { backgroundColor: 'rgba(250,251,247,0.82)', borderWidth: 1, borderColor: COLOR.line },
});
