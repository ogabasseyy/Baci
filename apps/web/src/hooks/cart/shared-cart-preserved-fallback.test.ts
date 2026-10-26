import { expect, it, vi } from 'vitest';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import { fetchSharedCartSnapshot } from './shared-cart-client';
import { adoptPreservedFallback } from './shared-cart-preserved-fallback';
import { adoptPreservedCart } from './shared-cart-preserved-session';
import { snapshot } from './shared-cart-provisioning.test-support';

vi.mock('./cart-storage', () => ({
  getCartFromStorage: vi.fn(),
  getSharedCartImportReceipt: vi.fn(),
  saveCartToStorage: vi.fn(),
}));
vi.mock('./shared-cart-client', () => ({
  fetchSharedCartSnapshot: vi.fn(),
}));
vi.mock('./shared-cart-preserved-session', () => ({
  adoptPreservedCart: vi.fn(),
}));

function context() {
  return {
    adoptOutcomeRef: { current: null },
    createAttemptedRef: { current: true },
    createOpRef: { current: 'op' },
    createRequestRef: { current: { id: 'req' } },
    retiredCartIdRef: { current: null },
  };
}

it('drops the populated create request on a retryable preserved read', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
  } as never);
  const ctx = context();
  await expect(
    adoptPreservedFallback(ctx as never, 'shop', () => true, vi.fn())
  ).resolves.toEqual({
    ok: false,
    code: 'temporarily_unavailable',
    retryable: true,
  });
  expect(ctx.createRequestRef.current).toBeNull();
});

it('returns null for a definitive missing preserved cart', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: false,
    code: 'not_found',
    retryable: false,
  } as never);
  await expect(
    adoptPreservedFallback(context() as never, 'shop', () => true, vi.fn())
  ).resolves.toBeNull();
});

it('adopts a live preserved snapshot', async () => {
  const snap = snapshot();
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snap,
    warnings: [],
  } as never);
  vi.mocked(adoptPreservedCart).mockReturnValue(true as never);
  vi.mocked(getCartFromStorage).mockReturnValue([] as never);
  vi.mocked(getSharedCartImportReceipt).mockReturnValue(null as never);
  const ctx = { ...context(), hydrateMissing: vi.fn() };
  await expect(
    adoptPreservedFallback(ctx as never, 'shop', () => true, vi.fn())
  ).resolves.toEqual({ ok: true });
  expect(adoptPreservedCart).toHaveBeenCalledWith(ctx, snap);
});
