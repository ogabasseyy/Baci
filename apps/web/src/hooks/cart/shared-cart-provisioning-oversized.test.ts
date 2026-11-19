import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getCartFromStorage, saveCartToStorage } from './cart-storage';
import {
  fetchSharedCartProducts,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  cartItem,
  MERCHANT_ID,
  mockAdopted,
  resetCartSessionHintForTests,
  SLUG,
} from './shared-cart-provisioning.test-support';
import { useSharedCart } from './use-shared-cart';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
afterEach(() => resetCartSessionHintForTests());

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
