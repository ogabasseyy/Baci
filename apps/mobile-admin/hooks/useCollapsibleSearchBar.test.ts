// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { describe, expect, it } from 'vitest';
import { useCollapsibleSearchBar } from './useCollapsibleSearchBar';

function scrollEvent(y: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { y } },
  } as NativeSyntheticEvent<NativeScrollEvent>;
}

describe('useCollapsibleSearchBar', () => {
  it('starts with the search actions visible', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    expect(result.current.isSearchActionsVisible).toBe(true);
  });

  it('hides the search actions when scrolling down past the collapse offset', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });

    expect(result.current.isSearchActionsVisible).toBe(false);
  });

  it('does not hide the search actions when scrolling down but staying at or below the collapse offset', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(40));
    });

    expect(result.current.isSearchActionsVisible).toBe(true);
  });

  it('shows the search actions again when scrolling back up', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });
    expect(result.current.isSearchActionsVisible).toBe(false);

    act(() => {
      result.current.handleScroll(scrollEvent(40));
    });

    expect(result.current.isSearchActionsVisible).toBe(true);
  });

  it('ignores small scroll deltas below the threshold', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(5));
    });

    expect(result.current.isSearchActionsVisible).toBe(true);

    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });
    expect(result.current.isSearchActionsVisible).toBe(false);

    act(() => {
      result.current.handleScroll(scrollEvent(95));
    });

    expect(result.current.isSearchActionsVisible).toBe(false);
  });

  it('accumulates repeated small downward deltas before hiding actions', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    for (const y of [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]) {
      act(() => {
        result.current.handleScroll(scrollEvent(y));
      });
    }
    expect(result.current.isSearchActionsVisible).toBe(true);

    act(() => {
      result.current.handleScroll(scrollEvent(60));
    });

    expect(result.current.isSearchActionsVisible).toBe(false);
  });

  it('keeps the hidden baseline current while scrolling farther down', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });
    expect(result.current.isSearchActionsVisible).toBe(false);

    act(() => {
      result.current.handleScroll(scrollEvent(400));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(380));
    });

    expect(result.current.isSearchActionsVisible).toBe(true);
  });

  it('keeps the visible baseline current before hiding again', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    act(() => {
      result.current.handleScroll(scrollEvent(0));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });
    expect(result.current.isSearchActionsVisible).toBe(false);

    act(() => {
      result.current.handleScroll(scrollEvent(200));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(180));
    });
    expect(result.current.isSearchActionsVisible).toBe(true);

    act(() => {
      result.current.handleScroll(scrollEvent(100));
    });
    act(() => {
      result.current.handleScroll(scrollEvent(120));
    });

    expect(result.current.isSearchActionsVisible).toBe(false);
  });

  it('returns a searchBarAnim value usable by an Animated component', () => {
    const { result } = renderHook(() => useCollapsibleSearchBar());

    expect(result.current.searchBarAnim).toBeTruthy();
    expect(typeof result.current.handleScroll).toBe('function');
  });
});
