import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SharedCartPendingEntry } from './shared-cart-state';
import { useCartPeerPreview } from './use-cart-peer-preview';
import {
  context,
  edit,
  line,
  peerEdit,
  settledBy,
  snapshot,
  tabs,
} from './use-cart-peer-preview.test-support';

describe('cart peer preview', () => {
  it('announces an edit while it is pending and settles with the saved version', () => {
    const t = tabs();
    const { rerender } = renderHook((p) => useCartPeerPreview(p, t.open), {
      initialProps: context(),
    });
    expect(t.posted).toEqual([]);

    rerender(
      context({ display: [line('l1', 3), line('l2', 1)], queue: [edit] })
    );
    expect(t.posted).toEqual([
      {
        cartId: 'c',
        kind: 'edit',
        lines: [
          { id: 'l1', quantity: 3 },
          { id: 'l2', quantity: 1 },
        ],
        merchantId: 'm',
        sender: expect.any(String),
        version: 2,
      },
    ]);

    rerender(context({ display: [line('l1', 3), line('l2', 1)] }, 3));
    expect(t.posted.at(-1)).toEqual({
      cartId: 'c',
      kind: 'settled',
      merchantId: 'm',
      sender: expect.any(String),
      version: 3,
    });
  });

  it('does not announce silent import work', () => {
    const t = tabs();
    renderHook(() =>
      useCartPeerPreview(
        context({ queue: [{ ...edit, silent: true }] }),
        t.open
      )
    );
    expect(t.posted).toEqual([]);
  });

  it('shows the other tab’s edit at once and lets go once the server copy catches up', () => {
    const t = tabs();
    const { result, rerender } = renderHook(
      (p) => useCartPeerPreview(p, t.open),
      { initialProps: context() }
    );
    expect(result.current).toBeNull();

    act(() => t.deliver(peerEdit));
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);

    act(() => t.deliver({ ...settledBy, version: 3 }));
    // Still waiting for this tab's own authorized refetch.
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);

    rerender(context({ display: [line('l1', 3)] }, 3));
    expect(result.current).toBeNull();
  });

  it('drops the preview at once when the other tab’s edit did not save', () => {
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(peerEdit));
    act(() => t.deliver({ ...settledBy, version: 2 }));
    expect(result.current).toBeNull();
  });

  it.each([
    ['another cart', { ...peerEdit, cartId: 'other' }],
    ['another merchant', { ...peerEdit, merchantId: 'other' }],
    ['an older cart version', { ...peerEdit, version: 1 }],
    ['a malformed message', { ...peerEdit, lines: 'all' }],
  ])('ignores %s', (_label, message) => {
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(message));
    expect(result.current).toBeNull();
  });

  it('keeps this tab’s own pending edit ahead of the other tab’s', () => {
    const t = tabs();
    const { result, rerender } = renderHook(
      (p) => useCartPeerPreview(p, t.open),
      { initialProps: context() }
    );
    act(() => t.deliver(peerEdit));
    expect(result.current).not.toBeNull();

    rerender(context({ queue: [edit] }));
    expect(result.current).toBeNull();
    act(() => t.deliver(peerEdit));
    expect(result.current).toBeNull();

    // The earlier preview must not come back once the edit is sent.
    rerender(context({}, 3));
    expect(result.current).toBeNull();
  });

  it('still shows the other tab’s edit while only silent import work is queued', () => {
    const t = tabs();
    const { result } = renderHook(() =>
      useCartPeerPreview(
        context({ queue: [{ ...edit, silent: true }] }),
        t.open
      )
    );
    act(() => t.deliver(peerEdit));
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);
  });

  it('lets go when this tab’s cart moves past the one the edit was made on', () => {
    const t = tabs();
    const { result, rerender } = renderHook(
      (p) => useCartPeerPreview(p, t.open),
      { initialProps: context() }
    );
    act(() => t.deliver(peerEdit));
    expect(result.current).not.toBeNull();

    // Another device added a line: the editing tab never saw it.
    rerender(
      context({ display: [line('l1', 1), line('l2', 1), line('l3', 1)] }, 3)
    );
    expect(result.current).toBeNull();
  });

  it('says nothing for an edit that changes no quantity', () => {
    const t = tabs();
    const assurance: SharedCartPendingEntry = {
      ...edit,
      intent: {
        hasAssurance: true,
        kind: 'set_assurance',
        target: { kind: 'lineId', lineId: 'l1' },
      },
    };
    const { rerender } = renderHook((p) => useCartPeerPreview(p, t.open), {
      initialProps: context({ queue: [assurance] }),
    });
    rerender(context({}, 3));
    expect(t.posted).toEqual([]);
  });

  it('does not repeat an edit when nothing shared changed', () => {
    const t = tabs();
    const display = [line('l1', 3), line('l2', 1)];
    const { rerender } = renderHook((p) => useCartPeerPreview(p, t.open), {
      initialProps: context({ display, queue: [edit] }),
    });
    expect(t.posted).toHaveLength(1);

    // Same quantities in a new array, as after product details load.
    rerender(context({ display: [...display], queue: [edit] }));
    expect(t.posted).toHaveLength(1);

    rerender(
      context({ display: [line('l1', 4), line('l2', 1)], queue: [edit] })
    );
    expect(t.posted).toHaveLength(2);
  });

  it('keeps an edit made on a newer cart than this tab holds', () => {
    const t = tabs();
    const { result, rerender } = renderHook(
      (p) => useCartPeerPreview(p, t.open),
      { initialProps: context() }
    );
    // The editing tab saved its first edit (version 3) and has a second
    // pending; this tab has not refetched yet.
    act(() => t.deliver({ ...peerEdit, version: 3 }));
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);

    // Catching up to version 3 keeps the second edit on screen.
    rerender(context({}, 3));
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);
  });

  it('keeps a third tab’s pending edit when another tab settles', () => {
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(peerEdit));
    act(() =>
      t.deliver({
        ...peerEdit,
        lines: [{ id: 'l1', quantity: 5 }],
        sender: 'tab-b',
      })
    );
    // Tab A's edit was rejected: it settles at the unchanged version.
    act(() =>
      t.deliver({
        cartId: 'c',
        kind: 'settled',
        merchantId: 'm',
        sender: 'tab-a',
        version: 2,
      })
    );
    expect(result.current).toEqual([{ id: 'l1', quantity: 5 }]);
  });

  it('stays silent and deaf for disabled, unlinked, or finished carts', () => {
    const t = tabs();
    const open = vi.fn(t.open);
    renderHook(() =>
      useCartPeerPreview({ ...context(), enabled: false }, open)
    );
    renderHook(() => useCartPeerPreview(context({ cartId: null }), open));
    renderHook(() =>
      useCartPeerPreview(
        context({ confirmed: { ...snapshot(2), state: 'completed' } }),
        open
      )
    );
    renderHook(() =>
      useCartPeerPreview(context({ importStatus: 'pending' }), open)
    );
    expect(open).not.toHaveBeenCalled();
  });
});
