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

const SPRING = { damping: 26, stiffness: 240, mass: 0.9 } as const;
const HANDLE_BLOCK = 26;
/** How far the sheet may be pulled below its collapsed height before letting go
 * closes the route instead of snapping back. */
const DISMISS_PULL = 58;

export type DragSheetProps = {
  snap: SheetState;
  onSnap: (snap: SheetState) => void;
  /** Visible height in points, shared so map overlays can sit above the sheet. */
  height: SharedValue<number>;
  bottomInset: number;
  /** Always-visible summary rendered directly under the drag handle. */
  peek: ReactNode;
  /** Dragging the collapsed sheet further down leaves the route entirely. */
  onDismiss: () => void;
  children: ReactNode;
};

/**
 * Bottom sheet the planner drags by its handle between three snap points.
 * Tapping the handle steps through them, and pulling the collapsed sheet down
 * past its stop leaves the route.
 */
export function DragSheet({
  snap,
  onSnap,
  height,
  bottomInset,
  peek,
  onDismiss,
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

  /** Tapping the handle steps through the detents, which replaces the pair of
   * More/Less buttons the peek used to carry. */
  const cycle = useCallback(() => {
    onSnap(snap === 'collapsed' ? 'half' : snap === 'half' ? 'full' : 'collapsed');
  }, [onSnap, snap]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          started.value = height.value;
          // Otherwise the keyboard is left hanging over wherever the sheet went.
          runOnJS(dismissKeyboard)();
        })
        .onUpdate((event) => {
          const next = started.value - event.translationY;
          // Below the collapsed detent the sheet gives, rather than stopping
          // dead, so a pull that is about to close the route looks like one.
          height.value = next < points.collapsed
            ? points.collapsed - Math.min(DISMISS_PULL, (points.collapsed - next) * 0.5)
            : clamp(next, points.collapsed, points.full);
        })
        .onEnd((event) => {
          const pulled = points.collapsed - height.value;
          if (pulled > 24 || (pulled > 2 && event.velocityY > 1400)) {
            height.value = withSpring(points.collapsed, SPRING);
            runOnJS(onDismiss)();
            return;
          }
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
    [commit, dismissKeyboard, height, onDismiss, points, started],
  );

  const sheetStyle = useAnimatedStyle(() => ({ height: height.value }));

  function measurePeek(event: LayoutChangeEvent) {
    const measured = Math.round(event.nativeEvent.layout.height) + HANDLE_BLOCK;
    if (Math.abs(measured - peekHeight) > 1) setPeekHeight(measured);
  }

  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        // Otherwise the keyboard is left hanging over wherever the sheet went.
        runOnJS(dismissKeyboard)();
        runOnJS(cycle)();
      }),
    [cycle, dismissKeyboard],
  );
  const grab = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

  return (
    <Animated.View style={[styles.sheet, SHADOW.sheet, sheetStyle]}>
      {/* The sheet is the content layer, not a floating control, so it takes an
          opaque surface rather than glass: glass belongs to the controls above
          the map, and clear glass here left the text sitting on the map. */}
      <View style={styles.surface}>
        <GestureDetector gesture={grab}>
          <View style={styles.grabber} accessibilityRole="button" accessibilityLabel="Resize the route panel">
            <View style={styles.handle} />
            <View onLayout={measurePeek}>{peek}</View>
          </View>
        </GestureDetector>
        <View style={styles.body}>{children}</View>
      </View>
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
    backgroundColor: COLOR.surface,
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
