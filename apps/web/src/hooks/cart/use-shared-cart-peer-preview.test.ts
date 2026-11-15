import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';

/** Two hooks in one test stand in for two tabs of one browser. */
class TabChannel {
  static open = new Set<TabChannel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    TabChannel.open.add(this);
  }
  postMessage(data: unknown): void {
    for (const other of TabChannel.open)
      if (other !== this && other.name === this.name)
        other.onmessage?.({ data: structuredClone(data) });
  }
  close(): void {
    TabChannel.open.delete(this);
  }
}

function snapshot(quantity: number, version: number): CartSnapshot {
  const line = {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000 * quantity,
    quantity,
    unitPriceMinor: 10000,
  } as CartLine;
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [line],
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor: line.lineTotalMinor,
    totalMinor: line.lineTotalMinor,
    version,
  } as CartSnapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  TabChannel.open.clear();
  vi.stubGlobal('BroadcastChannel', TabChannel);
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot(1, 3),
    warnings: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openTab() {
  return renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: 'ogabassey',
      sessionGeneration: 1,
    })
  );
}

it('shows a quantity change in the second tab before the save returns', async () => {
  const editing = openTab();
  const watching = openTab();
  await waitFor(() => {
    expect(editing.result.current.cart[0]?.serverLineId).toBe('line-1');
    expect(watching.result.current.cart[0]?.serverLineId).toBe('line-1');
    expect(editing.result.current.importStatus).not.toBe('pending');
    expect(watching.result.current.importStatus).not.toBe('pending');
  });
  // The save never returns within this test: the server has confirmed nothing.
  vi.mocked(sendSharedCartCommand).mockReturnValue(new Promise(() => {}));
  const line = editing.result.current.cart[0];
  if (!line) throw new Error('expected a line');

  act(() => {
    editing.result.current.updateQuantity(line.cartItemId, 3);
  });

  expect(editing.result.current.cart[0]?.quantity).toBe(3);
  await waitFor(() =>
    expect(watching.result.current.cart[0]?.quantity).toBe(3)
  );
  expect(watching.result.current.cartCount).toBe(3);
  expect(watching.result.current.cartTotal).toBe(300);
  // The watching tab issued no command of its own, and reports the shown
  // cart as not yet confirmed so checkout waits for the server copy.
  expect(sendSharedCartCommand).toHaveBeenCalledTimes(1);
  expect(watching.result.current.syncStatus).toBe('pending');
  expect(watching.result.current.version).toBe(3);
});
