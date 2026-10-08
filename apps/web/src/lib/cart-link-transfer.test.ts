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
  vi.mocked(createClient).mockReturnValue({
    from: vi.fn(() => chain),
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
    data: [{ id: added, name: 'Phone', status: 'active', images: [] }],
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
