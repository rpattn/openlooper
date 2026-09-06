import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

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
      <Surface
        active={active}
        accent={accent}
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
      </Surface>
    </Pressable>
  );
}

/**
 * An active control is a solid accent rather than tinted glass, so its white
 * symbol keeps its contrast wherever the button lands on the map — and so the
 * accent reads as "this is on" rather than as decoration.
 */
function Surface({
  active,
  accent,
  style,
  children,
}: {
  active: boolean;
  accent: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (active) return <View style={[style, { backgroundColor: accent }]}>{children}</View>;
  return (
    <GlassSurface variant="regular" style={style}>
      {children}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  surface: { overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallback: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.4 },
});
