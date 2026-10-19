import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  cartItem,
  cartLine,
  MERCHANT_ID,
  mockAdopted,
  product,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

it('retires a completed cart and provisions empty before the next add', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ state: 'completed' }),
    warnings: [],
  });
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  const newId = '33333333-3333-4333-8333-333333333333';
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 0, lines: [] }),
    warnings: [],
  });
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 1 }),
    warnings: [],
  });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.isHydrated).toBe(true));
  await waitFor(() => expect(result.current.cart).toEqual([]));
  await act(async () => result.current.addToCart(product()));
  await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
  expect(bootstrapSharedCart).toHaveBeenCalledTimes(1);
  expect(createSharedCart).toHaveBeenCalledWith(
    { operationId: expect.any(String) },
    SLUG
  );
  expect(result.current.cartId).toBe(newId);
});
it('retries an add on a new cart when checkout completed before the mutation', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  mockAdopted();
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  const newId = '33333333-3333-4333-8333-333333333333';
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ cartId: newId, version: 0, lines: [] }),
    warnings: [],
  });
  vi.mocked(sendSharedCartCommand)
    .mockResolvedValueOnce({
      ok: false,
      code: 'cart_locked',
      retryable: false,
      snapshot: null,
    })
    .mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ cartId: newId, version: 1 }),
      warnings: [],
    });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.cart).toHaveLength(1));
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ state: 'completed', version: 4 }),
    warnings: [],
  });
  await act(async () => result.current.addToCart(product()));
  await waitFor(() => expect(result.current.cartId).toBe(newId));
  expect(sendSharedCartCommand).toHaveBeenCalledTimes(2);
});

it('retains a device offer in storage for explicit review after replacement hits a newer remote version', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  saveCartToStorage(
    [
      cartItem({
        negotiatedPrice: 50,
        negotiationStatus: 'accepted',
        hasAssurance: true,
      }),
    ],
    SLUG
  );
  mockAdopted();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: false,
    code: 'version_conflict',
    retryable: false,
    snapshot: snapshot({ version: 4 }),
  });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.importConflicts).toHaveLength(1));
  await act(async () =>
    result.current.resolveImportConflicts([
      { item: { productId: 'prod-1' }, keep: 'incoming' },
    ])
  );
  await waitFor(() =>
    expect(result.current.syncError).toBe('refresh_required')
  );
  expect(result.current.importStatus).toBe('failed');
  expect(getCartFromStorage(SLUG)[0]).toMatchObject({
    negotiatedPrice: 50,
    negotiationStatus: 'accepted',
    hasAssurance: true,
  });
  expect(sendSharedCartCommand).toHaveBeenCalledTimes(1);
  await act(async () => result.current.retryImport());
  expect(result.current.importConflicts[0]).toMatchObject({
    incoming: { negotiatedUnitPriceMinor: 5000, negotiationStatus: 'accepted' },
  });
  expect(sendSharedCartCommand).toHaveBeenCalledTimes(1);
});
it('finishes an equal-quantity conflict without a mutation when the shopper keeps the server offer', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  saveCartToStorage(
    [cartItem({ negotiatedPrice: 50, negotiationStatus: 'accepted' })],
    SLUG
  );
  mockAdopted();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.importConflicts).toHaveLength(1));
  await act(async () =>
    result.current.resolveImportConflicts([
      { item: { productId: 'prod-1' }, keep: 'existing' },
    ])
  );
  await waitFor(() => expect(result.current.importStatus).toBe('done'));
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
  expect(getCartFromStorage(SLUG)[0].negotiatedPrice).toBeUndefined();
});

it('keeps overcapacity sibling offers cached while canonical removals make room, then imports every lane on explicit retry', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  const local = [
    cartItem({
      cartItemId: 'voucher-a',
      quizAwardId: 'award-a',
      quizVoucherToken: 'token-a',
    }),
    cartItem({
      cartItemId: 'voucher-b',
      quizAwardId: 'award-b',
      quizVoucherToken: 'token-b',
      hasAssurance: true,
    }),
  ];
  saveCartToStorage(local, SLUG);
  const full = Array.from({ length: 20 }, (_, index) =>
    cartLine({
      id: `server-${index}`,
      item: { productId: `prod-${index + 1}` },
    })
  );
  mockAdopted(3, full);
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(sendSharedCartCommand)
    .mockResolvedValueOnce({
      ok: true,
      snapshot: snapshot({ version: 4, lines: full.slice(0, 19) }),
      warnings: [],
      replayed: false,
    })
    .mockResolvedValueOnce({
      ok: true,
      snapshot: snapshot({ version: 5, lines: full.slice(0, 18) }),
      warnings: [],
      replayed: false,
    })
    .mockResolvedValueOnce({
      ok: true,
      snapshot: snapshot({
        version: 6,
        lines: [
          ...full.slice(0, 18),
          cartLine({
            id: 'voucher-a',
            voucherToken: 'token-a',
            voucherAwardId: 'award-a',
          }),
          cartLine({
            id: 'voucher-b',
            voucherToken: 'token-b',
            voucherAwardId: 'award-b',
            hasAssurance: true,
          }),
        ],
      }),
      warnings: [],
      replayed: false,
    });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() =>
    expect(result.current.importWarnings).toContain('import_capacity_exceeded')
  );
  expect(result.current.importStatus).toBe('failed');
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
  expect(getCartFromStorage(SLUG)).toEqual(local);
  act(() => result.current.removeFromCart('server-19'));
  await waitFor(() => expect(result.current.version).toBe(4));
  act(() => result.current.removeFromCart('server-18'));
  await waitFor(() => expect(result.current.version).toBe(5));
  expect(result.current.importWarnings).toContain('import_capacity_exceeded');
  expect(getCartFromStorage(SLUG)).toEqual(local);
  act(() => result.current.resolveImportConflicts([]));
  await waitFor(() => expect(result.current.importStatus).toBe('done'));
  const submitted = vi.mocked(sendSharedCartCommand).mock.calls[2][0];
  expect(submitted.command).toMatchObject({
    type: 'replace',
    lines: expect.arrayContaining([
      expect.objectContaining({ voucherToken: 'token-a' }),
      expect.objectContaining({ voucherToken: 'token-b', hasAssurance: true }),
    ]),
  });
  expect(result.current.cart).toHaveLength(20);
  expect(result.current.importWarnings).toEqual([]);
});

it('retains an oversized device import until the shopper explicitly discards it', async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  const local = Array.from({ length: 21 }, (_, index) =>
    cartItem({ id: `local-${index}`, cartItemId: `local-${index}` })
  );
  saveCartToStorage(local, SLUG);
  mockAdopted();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() =>
    expect(result.current.importWarnings).toContain('import_capacity_exceeded')
  );
  expect(getCartFromStorage(SLUG)).toEqual(local);
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
  act(() => result.current.discardLegacyImport());
  await waitFor(() => expect(result.current.importStatus).toBe('skipped'));
  expect(result.current.importWarnings).toEqual([]);
  expect(getCartFromStorage(SLUG).map((line) => line.id)).toEqual(['prod-1']);
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});
