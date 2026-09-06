import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';

export type CollapsibleProps = {
  title: string;
  /** Short summary shown next to the title while the section is closed. */
  badge?: string;
  defaultOpen?: boolean;
  tone?: 'panel' | 'dev';
  children: ReactNode;
};

/** Panel that stays out of the way until the planner opens it. */
export function Collapsible({
  title,
  badge,
  defaultOpen = false,
  tone = 'panel',
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={tone === 'dev' ? styles.dev : styles.panel}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}${badge ? `, ${badge}` : ''}`}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        <Text style={styles.title}>{title}</Text>
        {!!badge && <Text style={styles.badge}>{badge}</Text>}
        <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: RADIUS.panel, backgroundColor: COLOR.panel, overflow: 'hidden' },
  dev: {
    borderWidth: 1,
    borderColor: '#937a30',
    borderRadius: RADIUS.panel,
    backgroundColor: '#fff8dc',
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12 },
  title: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  badge: { flex: 1, color: COLOR.muted, fontSize: 12 },
  chevron: { color: COLOR.muted, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  body: { gap: 9, paddingHorizontal: 12, paddingBottom: 12 },
});
