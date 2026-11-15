import type { CartSnapshot } from '@baci/shared/cart';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenCartPeerChannel } from './cart-peer-preview';
import type { SharedCartDisplayItem } from './cart-types';
import {
  initialSharedCartState,
  type SharedCartPendingEntry,
  type SharedCartState,
} from './shared-cart-state';
import {
  type CartPeerPreviewContext,
  useCartPeerPreview,
} from './use-cart-peer-preview';

function line(serverLineId: string, quantity: number): SharedCartDisplayItem {
  return {
    cartItemId: serverLineId,
    id: `product-${serverLineId}`,
    name: 'Phone',
    pendingTempId: null,
    price: 100,
    quantity,
    serverLineId,
  } as SharedCartDisplayItem;
}

function snapshot(version: number): CartSnapshot {
  return {
    cartId: 'c',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2099-01-01',
    lines: [],
    merchantId: 'm',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version,
  } as CartSnapshot;
}

const edit: SharedCartPendingEntry = {
  attempts: 0,
  intent: {
    kind: 'set_quantity',
    quantity: 3,
    target: { kind: 'lineId', lineId: 'l1' },
  },
  operationId: 'op-1',
  state: 'queued',
};

function context(
  state: Partial<SharedCartState> = {},
  version = 2
): CartPeerPreviewContext {
  return {
    enabled: true,
    merchantId: 'm',
    sessionGeneration: 1,
    state: {
      ...initialSharedCartState,
      cartId: 'c',
      confirmed: snapshot(version),
      display: [line('l1', 1), line('l2', 1)],
      generation: 1,
      importStatus: 'done',
      merchantId: 'm',
      ...state,
    },
  };
}

/** Same-browser tabs: a post reaches every other open channel. */
function tabs() {
  const listeners = new Set<(value: unknown) => void>();
  const posted: unknown[] = [];
  const open: OpenCartPeerChannel = (_merchantId, onMessage) => {
    listeners.add(onMessage);
    return {
      close: () => {
        listeners.delete(onMessage);
      },
      post: (message) => {
        posted.push(message);
        for (const listener of listeners)
          if (listener !== onMessage) listener(message);
      },
    };
  };
  return {
    deliver: (value: unknown) => {
      for (const listener of listeners) listener(value);
    },
    open,
    posted,
  };
}

const peerEdit = {
  cartId: 'c',
  kind: 'edit',
  lines: [{ id: 'l1', quantity: 3 }],
  merchantId: 'm',
  version: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

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
        version: 2,
      },
    ]);

    rerender(context({ display: [line('l1', 3), line('l2', 1)] }, 3));
    expect(t.posted.at(-1)).toEqual({
      cartId: 'c',
      kind: 'settled',
      merchantId: 'm',
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

    act(() =>
      t.deliver({ cartId: 'c', kind: 'settled', merchantId: 'm', version: 3 })
    );
    // Still waiting for this tab's own authorized refetch.
    expect(result.current).toEqual([{ id: 'l1', quantity: 3 }]);

    rerender(context({ display: [line('l1', 3)] }, 3));
    expect(result.current).toBeNull();
  });

  it('drops the preview at once when the other tab’s edit did not save', () => {
    const t = tabs();
    const { result } = renderHook(() => useCartPeerPreview(context(), t.open));
    act(() => t.deliver(peerEdit));
    act(() =>
      t.deliver({ cartId: 'c', kind: 'settled', merchantId: 'm', version: 2 })
    );
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
