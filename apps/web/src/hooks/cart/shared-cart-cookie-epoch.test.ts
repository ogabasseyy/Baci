import { act, renderHook, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';
import { runCartSessionTransition } from './cart-session-write-fence';
import { saveCartToStorage } from './cart-storage';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { createCartProvisioning } from './shared-cart-provisioning';
import {
  cartItem,
  MERCHANT_ID,
  product,
  SLUG,
  snapshot,
} from './shared-cart-provisioning.test-support';
import {
  getCartSessionGeneration,
  subscribeCartSessionGeneration,
} from './shared-cart-storage';
import { useSharedCart } from './use-shared-cart';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
  vi.mocked(bootstrapSharedCart).mockResolvedValue({ ok: true });
  vi.mocked(createSharedCart).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ lines: [] }),
    warnings: [],
  });
  vi.mocked(sendSharedCartCommand).mockResolvedValue({
    ok: true,
    replayed: false,
    snapshot: snapshot({ lines: [] }),
    warnings: [],
  });
});
it.each([
  'existing',
  'new',
] as const)('fences a stale %s cart action before the other tab storage event is delivered', async (mode) => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue(
    mode === 'existing'
      ? { ok: true, snapshot: snapshot({ lines: [] }), warnings: [] }
      : { ok: false, code: 'unauthorized', retryable: false, snapshot: null }
  );
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.importStatus).toBe('skipped'));
  // Deliberately do not dispatch StorageEvent: a background tab may observe
  // its asynchronous callbacks before that event reaches its JS realm.
  window.localStorage.setItem(
    'baci-cart-authority-epoch',
    'retired-in-another-tab'
  );
  saveCartToStorage([cartItem({ name: 'Previous customer cache' })], SLUG);
  act(() => result.current.addToCart(product({ id: 'new-item' }), 1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(createSharedCart).not.toHaveBeenCalled();
  expect(sendSharedCartCommand).not.toHaveBeenCalled();
});

it('does not replay cached creation after retirement during bootstrap', async () => {
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  const runtime = result.current;
  runtime.adoptOutcomeRef.current = 'none';
  runtime.createRequestRef.current = {
    operationId: crypto.randomUUID(),
    lines: [],
  };
  vi.mocked(bootstrapSharedCart).mockImplementationOnce(async () => {
    window.localStorage.setItem('baci-cart-authority-epoch', 'new-customer');
    return { ok: true };
  });
  await act(async () => {
    await expect(
      createCartProvisioning(runtime).ensureCart()
    ).resolves.toBeNull();
  });
  expect(bootstrapSharedCart).toHaveBeenCalledOnce();
  expect(createSharedCart).not.toHaveBeenCalled();
});
it('reports a retryable provisioning failure when epoch storage is denied', async () => {
  const { result } = renderHook(() =>
    useSharedCartRuntime({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  act(() =>
    result.current.dispatch({
      type: 'link/start',
      generation: 1,
      merchantId: MERCHANT_ID,
      cached: [],
      products: {},
    })
  );
  const denied = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('storage denied');
    });
  try {
    await act(async () => {
      await expect(
        createCartProvisioning(result.current).ensureCart()
      ).resolves.toEqual({
        ok: false,
        code: 'temporarily_unavailable',
        retryable: true,
      });
    });
    expect(result.current.state.syncError).toBe('temporarily_unavailable');
    expect(createSharedCart).not.toHaveBeenCalled();
  } finally {
    denied.mockRestore();
  }
});
it('surfaces a retryable queued-command failure when storage becomes denied', async () => {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ lines: [] }),
    warnings: [],
  });
  const { result } = renderHook(() =>
    useSharedCart({
      merchantId: MERCHANT_ID,
      merchantSlug: SLUG,
      sessionGeneration: 1,
    })
  );
  await waitFor(() => expect(result.current.importStatus).toBe('skipped'));
  const denied = vi
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('storage denied');
    });
  try {
    act(() => result.current.addToCart(product({ id: 'new-item' }), 1));
    await waitFor(() =>
      expect(result.current.syncError).toBe('temporarily_unavailable')
    );
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  } finally {
    denied.mockRestore();
  }
});

it('sends the first fresh edit after a failed transition relinks the cart', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: new CookieLockHarness(),
  });
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ lines: [] }),
    warnings: [],
  });
  try {
    const { result } = renderHook(() => {
      const generation = useSyncExternalStore(
        subscribeCartSessionGeneration,
        getCartSessionGeneration
      );
      return useSharedCart({
        merchantId: MERCHANT_ID,
        merchantSlug: SLUG,
        sessionGeneration: generation,
      });
    });
    await waitFor(() => expect(result.current.importStatus).toBe('skipped'));
    await act(async () => {
      await runCartSessionTransition(SLUG, false, async () => false, {
        isSuccessful: Boolean,
      });
    });
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2)
    );
    act(() => result.current.addToCart(product({ id: 'new-item' }), 1));
    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledOnce());
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});
