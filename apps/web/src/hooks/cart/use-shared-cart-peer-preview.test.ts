import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import {
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
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

function product(): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
  } as Product;
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
  resetCartSessionHintForTests();
  writeCartSessionHint(MERCHANT_ID, '1');
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
  resetCartSessionHintForTests();
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

it('keeps the second tab’s own lines for commands while it shows the preview', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot(10, 3),
    warnings: [],
  });
  const editing = openTab();
  const watching = openTab();
  await waitFor(() => {
    expect(editing.result.current.cart[0]?.quantity).toBe(10);
    expect(watching.result.current.cart[0]?.quantity).toBe(10);
    expect(editing.result.current.importStatus).not.toBe('pending');
    expect(watching.result.current.importStatus).not.toBe('pending');
  });
  vi.mocked(sendSharedCartCommand).mockReturnValue(new Promise(() => {}));
  const line = editing.result.current.cart[0];
  if (!line) throw new Error('expected a line');

  // The line sits at the per-line cap; the editing tab drops it to 1.
  act(() => {
    editing.result.current.updateQuantity(line.cartItemId, 1);
  });
  await waitFor(() =>
    expect(watching.result.current.cart[0]?.quantity).toBe(1)
  );

  // Until the reduction is confirmed, this tab's own line is still at the
  // cap: an add built on the preview could reach the server first and be
  // rejected, or show eleven units.
  expect(watching.result.current.ownCart?.[0]?.quantity).toBe(10);
  act(() => {
    watching.result.current.addToCart(product(), 1);
  });
  expect(
    watching.result.current.ownCart?.some((item) => item.pendingTempId != null)
  ).toBe(false);
  expect(watching.result.current.cart[0]?.quantity).toBe(1);
});

it('shows a second tab the higher quantity when a unit is added to a line', async () => {
  const editing = openTab();
  const watching = openTab();
  await waitFor(() => {
    expect(editing.result.current.cart[0]?.serverLineId).toBe('line-1');
    expect(watching.result.current.cart[0]?.serverLineId).toBe('line-1');
    expect(editing.result.current.importStatus).not.toBe('pending');
    expect(watching.result.current.importStatus).not.toBe('pending');
  });
  vi.mocked(sendSharedCartCommand).mockReturnValue(new Promise(() => {}));

  act(() => {
    editing.result.current.addToCart(product(), 1);
  });

  await waitFor(() =>
    expect(watching.result.current.cart[0]?.quantity).toBe(2)
  );
  expect(watching.result.current.cart).toHaveLength(1);
});
