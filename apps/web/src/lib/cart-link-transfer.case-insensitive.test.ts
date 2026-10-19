// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/client';
import {
  type FetchAndAddCartItemsOptions,
  fetchAndAddCartItems,
} from './cart-link-transfer';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

const lower = '77777777-7777-4777-8777-777777777777';
const upper = lower.toUpperCase();

function setupProductsQuery(result: {
  data: Record<string, unknown>[] | null;
  error: unknown;
}) {
  const terminal = Promise.resolve(result);
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValueOnce(chain).mockReturnValue(terminal);
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn(() => chain),
    rpc,
  } as unknown as ReturnType<typeof createClient>);
}

function setupOptions(
  overrides: Partial<FetchAndAddCartItemsOptions> = {}
): FetchAndAddCartItemsOptions & {
  toast: ReturnType<typeof vi.fn>;
  addToCart: ReturnType<typeof vi.fn>;
  setIsLoading: ReturnType<typeof vi.fn>;
} {
  const toast = vi.fn();
  const addToCart = vi.fn();
  const setIsLoading = vi.fn();
  return {
    itemIds: lower,
    quantity: 1,
    quizAwardId: null,
    quizVoucherToken: null,
    merchantId: 'merchant-1',
    cart: [],
    addToCart,
    toast,
    setIsLoading,
    ...overrides,
  } as FetchAndAddCartItemsOptions & {
    toast: ReturnType<typeof vi.fn>;
    addToCart: ReturnType<typeof vi.fn>;
    setIsLoading: ReturnType<typeof vi.fn>;
  };
}

function guestCartParam() {
  return new URLSearchParams(window.location.search).get('guest_cart');
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/cart');
});

it('transfers the handoff quantity when the catalog id differs in case', async () => {
  // resolveGuestCartTransfer keys quantities lowercase; a raw-case lookup
  // would miss and fall back to the generic qty param (under-adding).
  setupProductsQuery({
    data: [
      {
        id: upper,
        name: 'Phone',
        status: 'active',
        images: [],
        manage_stock: true,
        stock_quantity: 10,
      },
    ],
    error: null,
  });
  const options = setupOptions({
    itemIds: upper,
    quantity: 1,
    guestQuantities: new Map([[lower, 3]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).toHaveBeenCalledOnce();
  expect(options.addToCart).toHaveBeenCalledWith(
    expect.objectContaining({ id: upper }),
    3,
    undefined
  );
});

it('flags kept-higher-quantity when the catalog id differs in case', async () => {
  setupProductsQuery({
    data: [{ id: upper, name: 'Phone', status: 'active', images: [] }],
    error: null,
  });
  const options = setupOptions({
    itemIds: upper,
    quantity: 1,
    guestQuantities: new Map([[lower, 2]]),
    cart: [{ id: upper, quantity: 5 } as never],
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  // Target 2 below existing 5: additive-only transfer adds nothing but
  // must still name the kept quantity instead of skipping silently.
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Kept your cart quantities' })
  );
});

it('retains a rejected line when the catalog id differs in case', async () => {
  setupProductsQuery({
    data: [
      {
        id: upper,
        name: 'Phone',
        status: 'active',
        images: [],
        manage_stock: true,
        stock_quantity: 1,
      },
    ],
    error: null,
  });
  const options = setupOptions({
    itemIds: upper,
    quantity: 1,
    guestQuantities: new Map([[lower, 3]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Not enough stock' })
  );
  // The retry lookup is canonical too: without it the mixed-case
  // rejected id drops its quantity and the line is silently consumed.
  expect(JSON.parse(guestCartParam() ?? 'null')).toEqual([
    { product_id: upper, quantity: 3 },
  ]);
});
