import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCartPeerPreview } from './use-cart-peer-preview';
import {
  context,
  edit,
  line,
  peerEdit,
  settledBy,
  tabs,
} from './use-cart-peer-preview.test-support';

afterEach(() => {
  vi.useRealTimers();
});

describe('cart peer preview timing', () => {
  it('repeats a slow save’s announcement so the other tab keeps it', () => {
    vi.useFakeTimers();
    const t = tabs();
    const watching = renderHook(() => useCartPeerPreview(context(), t.open));
    renderHook(() =>
      useCartPeerPreview(
        context({ display: [line('l1', 3), line('l2', 1)], queue: [edit] }),
        t.open
      )
    );
    expect(watching.result.current).toEqual([
      { id: 'l1', quantity: 3 },
      { id: 'l2', quantity: 1 },
    ]);
    // One second per act, so each repeat's re-render lands at its own time.
    const advance = (seconds: number) => {
      for (let second = 0; second < seconds; second += 1)
        act(() => {
          vi.advanceTimersByTime(1000);
        });
    };
    advance(25);
    expect(watching.result.current).not.toBeNull();

    // A save that never finishes stops being repeated (5 repeats, last at
    // 20 s), so the hint expires 10 s later instead of pinning this tab.
    advance(4);
    expect(watching.result.current).not.toBeNull();
    advance(1);
    expect(watching.result.current).toBeNull();
  });

  it('gives up after ten seconds if the other tab never settles', () => {
    vi.useFakeTimers();
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(peerEdit));
    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(result.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });

  it('does not extend the deadline when the other tab settles', () => {
    vi.useFakeTimers();
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(peerEdit));
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    act(() => t.deliver({ ...settledBy, version: 3 }));
    expect(result.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBeNull();
  });
});
