import { Pressable, StyleSheet, Text } from 'react-native';

import { COLOR, RADIUS } from '@/theme';

/** The planner's two button weights, shared by the sheet and the home screen. */
export function SmallButton({
  label,
  onPress,
  dark,
  disabled,
}: {
  label: string;
  onPress: () => void;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.small, dark && styles.dark, disabled && styles.disabled]}
    >
      <Text style={[styles.smallText, dark && styles.darkText]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  accent,
  onPress,
  disabled,
}: {
  label: string;
  accent: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: accent }, disabled && styles.disabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  small: {
    minHeight: 36,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ccd2cb',
    borderRadius: 9,
    backgroundColor: COLOR.raised,
  },
  smallText: { color: COLOR.ink, fontSize: 11, fontWeight: '800' },
  dark: { backgroundColor: COLOR.ink, borderColor: COLOR.ink },
  darkText: { color: '#fff' },
  primary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.control - 1,
  },
  primaryText: { color: '#fff', fontWeight: '900' },
  disabled: { opacity: 0.4 },
});
