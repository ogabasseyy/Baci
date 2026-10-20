// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { useToast } from '@/hooks/use-toast';
import { reportCartLinkTransferOutcome } from './report-cart-link-transfer-outcome';

type ToastFn = ReturnType<typeof useToast>['toast'];

describe('reportCartLinkTransferOutcome', () => {
  const toast = vi.fn() as unknown as ToastFn;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/cart?guest_cart=abc');
  });

  it('toasts the singular added message and rewrites the URL', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');

    reportCartLinkTransferOutcome({
      addedCount: 1,
      firstAddedProductName: 'Widget',
      keptHigherQuantity: false,
      rejectedIds: [],
      guestQuantities: undefined,
      toast,
    });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to cart' })
    );
    expect(replaceSpy).toHaveBeenCalled();
  });

  it('toasts the plural message and the kept-quantities notice', () => {
    reportCartLinkTransferOutcome({
      addedCount: 3,
      firstAddedProductName: 'Widget',
      keptHigherQuantity: true,
      rejectedIds: [],
      guestQuantities: undefined,
      toast,
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '3 items added' })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Kept your cart quantities' })
    );
  });

  it('skips the added toast when nothing landed', () => {
    reportCartLinkTransferOutcome({
      addedCount: 0,
      firstAddedProductName: null,
      keptHigherQuantity: false,
      rejectedIds: ['prod-1'],
      guestQuantities: new Map([['prod-1', 2]]),
      toast,
    });

    expect(toast).not.toHaveBeenCalled();
  });
});
