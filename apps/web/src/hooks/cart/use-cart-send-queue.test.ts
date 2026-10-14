import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCartSendQueue } from './use-cart-send-queue';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

it('does not provision or send from a disabled cart client', () => {
  const ensureCart = vi.fn();
  const finishImportOp = vi.fn();
  const hydrateMissing = vi.fn();
  renderHook(() => {
    const runtime = useSharedCartRuntime({
      merchantId: 'm',
      merchantSlug: 'shop',
      sessionGeneration: 1,
      enabled: false,
    });
    useCartSendQueue({
      ...runtime,
      ensureCart,
      finishImportOp,
      hydrateMissing,
    });
  });
  expect(ensureCart).not.toHaveBeenCalled();
  expect(finishImportOp).not.toHaveBeenCalled();
  expect(hydrateMissing).not.toHaveBeenCalled();
});
