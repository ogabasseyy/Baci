import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHEET_EXIT_FALLBACK_MS,
  useSheetExitPresence,
} from './useSheetExitPresence';

describe('useSheetExitPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not presented while the sheet has never been opened', () => {
    const { result } = renderHook(() => useSheetExitPresence(false));

    expect(result.current.isPresented).toBe(false);
  });

  it('stays presented after closing so the exit animation can play', () => {
    const { rerender, result } = renderHook(
      ({ visible }) => useSheetExitPresence(visible),
      { initialProps: { visible: true } }
    );

    rerender({ visible: false });

    expect(result.current.isPresented).toBe(true);
  });

  it('releases the sheet once the exit animation finishes', () => {
    const { rerender, result } = renderHook(
      ({ visible }) => useSheetExitPresence(visible),
      { initialProps: { visible: true } }
    );
    rerender({ visible: false });

    act(() => result.current.finishExit());

    expect(result.current.isPresented).toBe(false);
  });

  it('releases the sheet after the fallback when no exit callback arrives', () => {
    const { rerender, result } = renderHook(
      ({ visible }) => useSheetExitPresence(visible),
      { initialProps: { visible: true } }
    );
    rerender({ visible: false });

    act(() => {
      vi.advanceTimersByTime(SHEET_EXIT_FALLBACK_MS);
    });

    expect(result.current.isPresented).toBe(false);
  });

  it('ignores a stale exit callback when the sheet is reopened mid-close', () => {
    const { rerender, result } = renderHook(
      ({ visible }) => useSheetExitPresence(visible),
      { initialProps: { visible: true } }
    );
    rerender({ visible: false });
    rerender({ visible: true });

    act(() => {
      result.current.finishExit();
      vi.advanceTimersByTime(SHEET_EXIT_FALLBACK_MS);
    });

    expect(result.current.isPresented).toBe(true);
  });
});
