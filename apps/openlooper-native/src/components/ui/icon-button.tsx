import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { GlassSurface } from './glass-surface';
import type { IconButtonProps } from './types';

/**
 * Circular floating control. On iOS it is an SF Symbol on liquid glass; on
 * Android and web the symbol falls back to a short text label.
 */
export function IconButton({
  symbol,
  fallbackLabel,
  accessibilityLabel,
  onPress,
  accent = COLOR.ink,
  size = 52,
  active = false,
  disabled = false,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        SHADOW.floating,
        { borderRadius: RADIUS.pill },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <GlassSurface
        variant="regular"
        tint={active ? accent : undefined}
        style={[styles.surface, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={styles.center}>
          <SymbolView
            name={symbol}
            size={Math.round(size * 0.44)}
            tintColor={active ? '#fff' : accent}
            weight="semibold"
            fallback={
              <Text style={[styles.fallback, { color: active ? '#fff' : accent }]}>
                {fallbackLabel}
              </Text>
            }
          />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: { overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallback: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.4 },
});
