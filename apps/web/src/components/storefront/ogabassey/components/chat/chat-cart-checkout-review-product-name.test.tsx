import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CartItem } from '@/hooks/cart';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  reviewedItems: null as unknown,
}));

vi.mock('@/hooks/cart/shared-cart-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/cart/shared-cart-client')>();
  return {
    ...actual,
    prepareSharedCartCheckout: (...args: unknown[]) => state.prepare(...args),
    reviewedCheckoutItems: () => state.reviewedItems,
  };
});

import { ChatCartCheckoutReview } from './chat-cart-checkout-review';

const cachedItem = {
  cartItemId: 'line-1',
  name: 'Cached old product name',
  price: 500,
  quantity: 2,
  serverLineId: 'line-1',
} as unknown as CartItem;

function review(productName?: string) {
  return {
    ok: true,
    replayed: false,
    sessionExpiresAtMonotonicMs: performance.now() + 30_000,
    sessionExpiresAtEpochMs: Date.now() + 30_000,
    sessionReused: false,
    review: {
      cartId: 'cart-1',
      cartVersion: 2,
      checkoutSessionId: 'session-1',
      currency: 'NGN',
      generation: 1,
      lines: [
        {
          available: true,
          effectiveUnitPriceMinor: 50_000,
          id: 'line-1',
          ...(productName === undefined ? {} : { productName }),
          quantity: 2,
        },
      ],
      merchantId: 'merchant-1',
      subtotalMinor: 100_000,
      unavailableCount: 0,
    },
  };
}

describe('ChatCartCheckoutReview product names', () => {
  beforeEach(() => {
    state.prepare.mockReset();
    state.reviewedItems = [cachedItem];
  });

  it('uses the reviewed product name and a generic fallback for older snapshots', async () => {
    state.prepare
      .mockResolvedValueOnce(review('Reviewed catalog name'))
      .mockResolvedValueOnce(review());
    const user = userEvent.setup();
    render(
      <ChatCartCheckoutReview
        currencyCode="NGN"
        items={[cachedItem]}
        merchantId="merchant-1"
        merchantSlug="store"
        sharedCartEnabled
        sharedCartRef={{ cartId: 'cart-1', version: 2 }}
        syncStatus="synced"
      />
    );
    const reviewButton = screen.getByRole('button', { name: 'Review checkout' });

    await user.click(reviewButton);
    expect(await screen.findByText('Reviewed catalog name')).toBeInTheDocument();
    expect(screen.queryByText('Cached old product name')).not.toBeInTheDocument();

    await user.click(reviewButton);
    expect(await screen.findByText('Product')).toBeInTheDocument();
    expect(screen.queryByText('Cached old product name')).not.toBeInTheDocument();
  });
});
