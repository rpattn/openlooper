import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { PrimaryButton, SmallButton } from './buttons';

export type DialogProps = {
  title: string;
  message?: string;
  /** Present when the dialog asks for a line of text, such as a route name. */
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel: () => void;
  accent: string;
  busy?: boolean;
};

/**
 * The planner's own confirmation card. `Alert` is unimplemented on web, so
 * naming and discarding a route ask here instead and read the same everywhere.
 */
export function Dialog({
  title,
  message,
  value,
  placeholder,
  onChange,
  confirmLabel,
  onConfirm,
  cancelLabel = 'Cancel',
  onCancel,
  accent,
  busy,
}: DialogProps) {
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        style={styles.backdrop}
        onPress={onCancel}
      />
      <View style={[styles.card, SHADOW.sheet]}>
        <Text style={styles.title}>{title}</Text>
        {!!message && <Text style={styles.message}>{message}</Text>}
        {value !== undefined && (
          <TextInput
            value={value}
            onChangeText={onChange}
            onSubmitEditing={onConfirm}
            placeholder={placeholder}
            placeholderTextColor={COLOR.faint}
            returnKeyType="done"
            autoFocus
            selectTextOnFocus
            style={styles.input}
            accessibilityLabel={title}
          />
        )}
        <View style={styles.actions}>
          <SmallButton label={cancelLabel} onPress={onCancel} />
          <View style={styles.grow}>
            <PrimaryButton
              label={busy ? 'Working…' : confirmLabel}
              accent={accent}
              disabled={busy}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(23,32,25,0.34)' },
  card: {
    width: '100%',
    maxWidth: 380,
    gap: 10,
    padding: 16,
    borderRadius: RADIUS.panel + 4,
    backgroundColor: COLOR.surface,
  },
  title: { color: COLOR.ink, fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  message: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLOR.line,
    borderRadius: 11,
    backgroundColor: COLOR.raised,
    color: COLOR.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
