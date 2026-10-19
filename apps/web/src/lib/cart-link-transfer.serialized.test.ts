// @vitest-environment jsdom
// Serialized-inventory half of the cart-link transfer suite: anchor-policy
// scenarios for fetchAndAddCartItems. Split from cart-link-transfer.test.ts
// to hold the 300-line file budget; setup helpers are duplicated so each
// suite stays self-contained.
import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/client';
import {
  type FetchAndAddCartItemsOptions,
  fetchAndAddCartItems,
} from './cart-link-transfer';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

const added = '55555555-5555-4555-8555-555555555555';

function setupProductsQuery(
  result: {
    data: Record<string, unknown>[] | null;
    error: unknown;
  },
  anchors: { data: unknown; error: unknown } = { data: null, error: null }
) {
  const terminal = Promise.resolve(result);
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.eq.mockReturnValueOnce(chain).mockReturnValue(terminal);
  const rpc = vi.fn(async () => anchors);
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn(() => chain),
    rpc,
  } as unknown as ReturnType<typeof createClient>);
  return { chain, rpc };
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
    itemIds: added,
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

it('gates an unmanaged parent on its strict serialized anchor', async () => {
  const { rpc } = setupProductsQuery(
    {
      data: [
        {
          id: added,
          name: 'Serialized Phone',
          status: 'active',
          images: [],
          manage_stock: false,
        },
      ],
      error: null,
    },
    {
      data: [
        {
          product_id: added,
          effective_policy: 'serialized_strict',
          available_units: 0,
        },
      ],
      error: null,
    }
  );
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 1]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith(
    'get_mcp_search_serialized_anchor_policies',
    {
      p_product_ids: [added],
      p_merchant_id: 'merchant-1',
    }
  );
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Not enough stock' })
  );
  expect(JSON.parse(guestCartParam() ?? 'null')).toEqual([
    { product_id: added, quantity: 1 },
  ]);
});

it('adds a then-unlimited line the stored stock would reject', async () => {
  setupProductsQuery(
    {
      data: [
        {
          id: added,
          name: 'Serialized Phone',
          status: 'active',
          images: [],
          manage_stock: true,
          stock_quantity: 0,
        },
      ],
      error: null,
    },
    {
      data: [
        {
          product_id: added,
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
        },
      ],
      error: null,
    }
  );
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 1]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).toHaveBeenCalledTimes(1);
  // The projected policy must reach addToCart: with stored
  // manage_stock:true + stock 0 the provider guard would silently drop
  // this purchasable line while the transfer reports success.
  expect(options.addToCart).toHaveBeenCalledWith(
    expect.objectContaining({ manage_stock: false, stock: 9999 }),
    1,
    undefined
  );
});

it('keeps stored stock when the anchor lookup fails', async () => {
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    setupProductsQuery(
      {
        data: [
          {
            id: added,
            name: 'Phone',
            status: 'active',
            images: [],
            manage_stock: false,
          },
        ],
        error: null,
      },
      { data: null, error: { message: 'down' } }
    );
    const options = setupOptions({
      itemIds: added,
      guestQuantities: new Map([[added, 1]]),
    });

    await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
    expect(options.addToCart).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch serialized anchor policy for cart transfer:',
      { message: 'down' }
    );
  } finally {
    errorSpy.mockRestore();
  }
});
