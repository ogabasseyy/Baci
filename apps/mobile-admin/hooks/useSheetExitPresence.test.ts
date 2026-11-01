import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHEET_DISMISS_REPORT_MS,
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

  describe('dismissal report', () => {
    function closeAndRelease(onDismissed: () => void) {
      const hook = renderHook(
        ({ visible }) => useSheetExitPresence(visible, onDismissed),
        { initialProps: { visible: true } }
      );
      hook.rerender({ visible: false });
      act(() => hook.result.current.finishExit());
      return hook;
    }

    it('reports once when the native modal says it has gone', () => {
      const onDismissed = vi.fn();
      const { result } = closeAndRelease(onDismissed);

      act(() => result.current.reportDismissed());
      act(() => {
        vi.advanceTimersByTime(SHEET_DISMISS_REPORT_MS);
      });

      expect(onDismissed).toHaveBeenCalledOnce();
    });

    it('still reports once after a delay when no native dismissal event arrives', () => {
      const onDismissed = vi.fn();
      closeAndRelease(onDismissed);
      expect(onDismissed).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(SHEET_DISMISS_REPORT_MS);
      });

      expect(onDismissed).toHaveBeenCalledOnce();
    });

    it('does not report for a sheet that was never opened', () => {
      const onDismissed = vi.fn();
      const { result } = renderHook(() =>
        useSheetExitPresence(false, onDismissed)
      );

      act(() => {
        result.current.reportDismissed();
        vi.advanceTimersByTime(SHEET_DISMISS_REPORT_MS);
      });

      expect(onDismissed).not.toHaveBeenCalled();
    });
  });
});
