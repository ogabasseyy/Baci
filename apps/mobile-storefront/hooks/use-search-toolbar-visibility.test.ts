import { act, renderHook } from '@testing-library/react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSearchToolbarVisibility } from './use-search-toolbar-visibility';

function event(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: {
      contentOffset: { y },
      contentSize: { height: 1000 },
      layoutMeasurement: { height: 500 },
    },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}
it('hides down-list, returns on reverse, resets for a new result set and stays visible while pinned', () => {
  const view = renderHook(
    ({ scope, pinned }: { scope: string; pinned: boolean }) =>
      useSearchToolbarVisibility(scope, pinned),
    { initialProps: { scope: 'iphone', pinned: false } }
  );
  act(() => view.result.current.onScroll(event(120)));
  expect(view.result.current.visible).toBe(false);
  act(() => view.result.current.onScroll(event(80)));
  expect(view.result.current.visible).toBe(true);
  act(() => view.result.current.onScroll(event(160)));
  view.rerender({ scope: 'laptop', pinned: false });
  expect(view.result.current.visible).toBe(true);
  act(() => view.result.current.onScroll(event(120)));
  view.rerender({ scope: 'laptop', pinned: true });
  act(() => view.result.current.onScroll(event(180)));
  expect(view.result.current.visible).toBe(true);
  view.rerender({ scope: 'laptop', pinned: false });
  act(() => view.result.current.onScroll(event(160)));
  expect(view.result.current.visible).toBe(true);
  act(() => view.result.current.onScroll(event(200)));
  expect(view.result.current.visible).toBe(false);
});
