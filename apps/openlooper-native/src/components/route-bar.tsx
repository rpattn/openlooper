import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { GlassSurface } from './ui/glass-surface';
import { IconButton } from './ui/icon-button';

export type RouteBarProps = {
  top: number;
  /** Name of the saved route being edited, if this route came from the library. */
  name?: string;
  canSave: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
};

/**
 * The map screen's only chrome at the top: leave the route, or save it and
 * leave. Everything else about the route lives in the sheet below.
 */
export function RouteBar({ top, name, canSave, saving, onBack, onSave }: RouteBarProps) {
  return (
    <View style={[styles.bar, { top }]} pointerEvents="box-none">
      <IconButton
        symbol="chevron.left"
        fallbackLabel="Back"
        accessibilityLabel="Close this route without saving"
        accent={COLOR.ink}
        size={44}
        onPress={onBack}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={canSave ? 'Save this route and go back' : 'Nothing to save'}
        accessibilityState={{ disabled: !canSave || saving }}
        disabled={!canSave || saving}
        onPress={onSave}
        style={({ pressed }) => [
          SHADOW.floating,
          styles.save,
          // Solid rather than tinted glass, so it keeps its contrast over any
          // base map and wherever liquid glass is unavailable. Green means there
          // is something to write; grey means the route is already saved — and
          // grey stays fully opaque so it reads as a state, not a faded button.
          { backgroundColor: canSave ? COLOR.ready : COLOR.idle },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
      {!!name && (
        <GlassSurface variant="regular" style={[styles.name, SHADOW.floating]}>
          <Text style={styles.nameText} numberOfLines={1}>
            {name}
          </Text>
        </GlassSurface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  save: {
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
  },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  name: {
    flexShrink: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADIUS.control,
    overflow: 'hidden',
  },
  nameText: { color: COLOR.ink, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});
