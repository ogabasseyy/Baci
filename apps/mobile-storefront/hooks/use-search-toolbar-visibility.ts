import { useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { resolveScrollHeaderVisibility } from '@/lib/scroll-header-visibility';

export function useSearchToolbarVisibility(scope: string, pinned: boolean) {
  const key = `${scope}:${pinned}`;
  const [visibility, setVisibility] = useState({ key, scope, isVisible: true });
  const tracker = useRef({ isVisible: true, previousOffsetY: 0 });
  if (visibility.key !== key) {
    tracker.current = {
      isVisible: true,
      previousOffsetY:
        visibility.scope === scope ? tracker.current.previousOffsetY : 0,
    };
    setVisibility({ key, scope, isVisible: true });
  }
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const next = resolveScrollHeaderVisibility({
      ...tracker.current,
      currentOffsetY: contentOffset.y,
      maximumOffsetY: Math.max(
        0,
        contentSize.height - layoutMeasurement.height
      ),
    });
    if (pinned) {
      tracker.current = { ...next, isVisible: true };
      return;
    }
    if (tracker.current.isVisible !== next.isVisible)
      setVisibility({ key, scope, isVisible: next.isVisible });
    tracker.current = next;
  };
  return {
    visible: pinned || visibility.key !== key || visibility.isVisible,
    onScroll,
  };
}
