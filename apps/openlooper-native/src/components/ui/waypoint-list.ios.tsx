import { Host, HStack, List, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  deleteDisabled,
  environment,
  foregroundColor,
  font,
  frame,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  moveDisabled,
  onTapGesture,
  scrollContentBackground,
  scrollDisabled,
} from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { COLOR } from '@/theme';
import { roleColor } from './waypoint-role';
import type { WaypointListProps } from './types';

// Edit mode keeps the grip and delete affordances on screen, so the list has a
// fixed row height and the host can be sized without measuring SwiftUI.
const ROW_HEIGHT = 52;

export function WaypointList({ rows, accent, editable, onMove, onDelete, onSelect }: WaypointListProps) {
  return (
    <Host style={[styles.host, { height: rows.length * ROW_HEIGHT + 4 }]} colorScheme="light" seedColor={accent}>
      <List
        modifiers={[
          listStyle('plain'),
          scrollDisabled(true),
          scrollContentBackground('hidden'),
          environment('editMode', editable ? 'active' : 'inactive'),
        ]}
      >
        <List.ForEach
          onDelete={(indices) => indices.slice().sort((a, b) => b - a).forEach(onDelete)}
          onMove={(sources, destination) => {
            const from = sources[0];
            if (from === undefined) return;
            // SwiftUI reports the insertion point in the pre-move list; the
            // planner works in post-removal indices.
            onMove(from, destination > from ? destination - 1 : destination);
          }}
        >
          {rows.map((row) => (
            <HStack
              key={row.id}
              spacing={10}
              modifiers={[
                frame({ height: ROW_HEIGHT }),
                listRowInsets({ top: 0, bottom: 0, leading: 12, trailing: 12 }),
                listRowBackground(COLOR.raised),
                listRowSeparator('hidden'),
                moveDisabled(row.locked || !editable),
                deleteDisabled(row.locked || !editable),
                onTapGesture(() => onSelect(row.id)),
              ]}
            >
              <Text
                modifiers={[
                  font({ size: 13, weight: 'heavy', design: 'rounded' }),
                  foregroundColor(roleColor(row.role)),
                  frame({ width: 22 }),
                ]}
              >
                {row.marker}
              </Text>
              <VStack alignment="leading" spacing={1}>
                <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundColor(COLOR.ink)]}>
                  {row.title}
                </Text>
                <Text modifiers={[font({ size: 12 }), foregroundColor(COLOR.muted)]}>
                  {row.subtitle}
                </Text>
              </VStack>
              <Spacer />
            </HStack>
          ))}
        </List.ForEach>
      </List>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { marginHorizontal: -4 },
});
