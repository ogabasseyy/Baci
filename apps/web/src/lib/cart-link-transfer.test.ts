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

const added = '55555555-5555-4555-8555-555555555555';
const missing = '66666666-6666-4666-8666-666666666666';

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

it('returns false when the product lookup fails', async () => {
  setupProductsQuery({ data: null, error: { message: 'down' } });
  const options = setupOptions();

  await expect(fetchAndAddCartItems(options)).resolves.toBe(false);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.setIsLoading).toHaveBeenCalledWith(false);
});

it('returns false when no products match', async () => {
  setupProductsQuery({ data: [], error: null });
  const options = setupOptions();

  await expect(fetchAndAddCartItems(options)).resolves.toBe(false);
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Product not found' })
  );
});

it('transfers available guest lines and retains missing ones', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
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
    itemIds: `${added},${missing}`,
    guestQuantities: new Map([
      [added, 1],
      [missing, 2],
    ]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).toHaveBeenCalledOnce();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Some items unavailable' })
  );
  expect(JSON.parse(guestCartParam() ?? 'null')).toEqual([
    { product_id: missing, quantity: 2 },
  ]);
});

it('retains guest lines that need option selection', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        has_variants: true,
      },
    ],
    error: null,
  });
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 1]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(JSON.parse(guestCartParam() ?? 'null')).toEqual([
    { product_id: added, quantity: 1 },
  ]);
});

it('retains stock-rejected lines for retry', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        manage_stock: true,
        stock_quantity: 0,
      },
    ],
    error: null,
  });
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 1]]),
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Not enough stock' })
  );
  expect(JSON.parse(guestCartParam() ?? 'null')).toEqual([
    { product_id: added, quantity: 1 },
  ]);
});

it('signals when the website cart keeps higher quantities than the chat cart', async () => {
  setupProductsQuery({
    data: [{ id: added, name: 'Phone', status: 'active', images: [] }],
    error: null,
  });
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 2]]),
    cart: [
      { id: added, quantity: 5 },
    ] as unknown as FetchAndAddCartItemsOptions['cart'],
  });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Kept your cart quantities' })
  );
});

it('retains variant lines as retryable on the legacy item_id path', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        has_variants: true,
      },
    ],
    error: null,
  });
  const options = setupOptions({ itemIds: added });
  window.history.pushState({}, '', `/cart?item_id=${added}&qty=1`);

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(new URLSearchParams(window.location.search).get('item_id')).toBe(
    added
  );
});

it('consumes a retained handoff once options are selected on the website', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        has_variants: true,
      },
    ],
    error: null,
  });
  const options = setupOptions({
    itemIds: added,
    guestQuantities: new Map([[added, 1]]),
    cart: [
      { id: added, quantity: 1, variantId: 'variant-1' },
    ] as unknown as FetchAndAddCartItemsOptions['cart'],
  });
  window.history.pushState(
    {},
    '',
    `/cart?guest_cart=${encodeURIComponent(JSON.stringify([{ product_id: added, quantity: 1 }]))}`
  );

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).not.toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Choose product options' })
  );
  expect(guestCartParam()).toBeNull();
});

it('rejects crafted legacy links before the catalog query', async () => {
  setupProductsQuery({ data: [], error: null });
  const overCount = setupOptions({
    itemIds: Array.from({ length: 21 }, (_, index) =>
      index.toString(16).padStart(36, '0')
    ).join(','),
  });

  await expect(fetchAndAddCartItems(overCount)).resolves.toBe(false);
  expect(overCount.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Invalid link' })
  );
  expect(vi.mocked(createClient)).not.toHaveBeenCalled();

  const overLength = setupOptions({ itemIds: `${'a'.repeat(2001)}` });
  await expect(fetchAndAddCartItems(overLength)).resolves.toBe(false);
  expect(overLength.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Invalid link' })
  );
});

it('treats an uppercase item_id as found when the catalog returns lowercase', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        manage_stock: true,
        stock_quantity: 10,
      },
    ],
    error: null,
  });
  const options = setupOptions({ itemIds: added.toUpperCase() });
  window.history.pushState(
    {},
    '',
    `/cart?item_id=${added.toUpperCase()}&qty=1`
  );

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(window.location.search).get('item_id')).toBeNull();
  expect(options.toast).not.toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Some items unavailable' })
  );
});

it('treats a null manage_stock handoff product as managed', async () => {
  setupProductsQuery({
    data: [
      {
        id: added,
        name: 'Phone',
        status: 'active',
        images: [],
        manage_stock: null,
        stock_quantity: 0,
      },
    ],
    error: null,
  });
  const options = setupOptions({ itemIds: added });

  await expect(fetchAndAddCartItems(options)).resolves.toBe(true);
  expect(options.addToCart).not.toHaveBeenCalled();
  expect(options.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Not enough stock' })
  );
});
