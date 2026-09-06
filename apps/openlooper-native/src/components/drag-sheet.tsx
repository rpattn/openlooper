import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import type { SheetState } from '@/domain/models';
import { COLLAPSED_FALLBACK, SHEET_FRACTION } from './sheet-detents';
import { GlassSurface } from './ui/glass-surface';

const SPRING = { damping: 26, stiffness: 240, mass: 0.9 } as const;
const HANDLE_BLOCK = 26;

export type DragSheetProps = {
  snap: SheetState;
  onSnap: (snap: SheetState) => void;
  /** Visible height in points, shared so map overlays can sit above the sheet. */
  height: SharedValue<number>;
  bottomInset: number;
  /** Always-visible summary rendered directly under the drag handle. */
  peek: ReactNode;
  children: ReactNode;
};

/**
 * Bottom sheet the planner can drag by its handle between three snap points.
 * The More/Less buttons drive the same `snap` prop, so both ways of resizing
 * stay in sync.
 */
export function DragSheet({
  snap,
  onSnap,
  height,
  bottomInset,
  peek,
  children,
}: DragSheetProps) {
  const { height: windowHeight } = useWindowDimensions();
  const [peekHeight, setPeekHeight] = useState(COLLAPSED_FALLBACK);

  const points = useMemo(() => {
    const collapsed = Math.min(peekHeight + bottomInset, windowHeight * 0.4);
    const full = Math.round(windowHeight * SHEET_FRACTION.full);
    const half = Math.max(
      collapsed + 40,
      Math.min(full, Math.round(windowHeight * SHEET_FRACTION.half)),
    );
    return { collapsed, half, full };
  }, [bottomInset, peekHeight, windowHeight]);

  const target = points[snap];
  const started = useSharedValue(0);
  const settled = useRef(false);

  useEffect(() => {
    // The first pass positions the sheet outright; later changes animate.
    if (!settled.current) {
      settled.current = true;
      height.value = target;
      return;
    }
    height.value = withSpring(target, SPRING);
  }, [height, target]);

  // `Keyboard.dismiss` is bound to the native keyboard object, which a worklet
  // cannot copy, so the gesture calls a plain function instead.
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const commit = useCallback(
    (next: SheetState) => {
      if (next !== snap) onSnap(next);
    },
    [onSnap, snap],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          started.value = height.value;
          // Otherwise the keyboard is left hanging over wherever the sheet went.
          runOnJS(dismissKeyboard)();
        })
        .onUpdate((event) => {
          height.value = clamp(started.value - event.translationY, points.collapsed, points.full);
        })
        .onEnd((event) => {
          // Project where a flick would land so a fast swipe skips a snap point.
          const projected = height.value - event.velocityY * 0.12;
          const entries: [SheetState, number][] = [
            ['collapsed', points.collapsed],
            ['half', points.half],
            ['full', points.full],
          ];
          let best = entries[0]!;
          for (const entry of entries)
            if (Math.abs(entry[1] - projected) < Math.abs(best[1] - projected)) best = entry;
          height.value = withSpring(best[1], SPRING);
          runOnJS(commit)(best[0]);
        }),
    [commit, dismissKeyboard, height, points, started],
  );

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));

  function measurePeek(event: LayoutChangeEvent) {
    const measured = Math.round(event.nativeEvent.layout.height) + HANDLE_BLOCK;
    if (Math.abs(measured - peekHeight) > 1) setPeekHeight(measured);
  }

  return (
    <Animated.View style={[styles.sheet, SHADOW.sheet, sheetStyle]}>
      <GlassSurface variant="regular" style={styles.surface}>
        <GestureDetector gesture={pan}>
          <View style={styles.grabber}>
            <View style={styles.handle} />
            <View onLayout={measurePeek}>{peek}</View>
          </View>
        </GestureDetector>
        <View style={styles.body}>{children}</View>
      </GlassSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  surface: {
    flex: 1,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLOR.line,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  grabber: { paddingTop: 8 },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    marginBottom: 13,
    borderRadius: 3,
    backgroundColor: '#b9c1b8',
  },
  body: { flex: 1 },
});
