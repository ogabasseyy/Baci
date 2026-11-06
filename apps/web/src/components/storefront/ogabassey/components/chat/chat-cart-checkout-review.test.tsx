import { act, fireEvent, render, screen } from '@testing-library/react';
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
    reviewedCheckoutItems: (display: unknown, review: unknown) =>
      state.reviewedItems ?? actual.reviewedCheckoutItems(display as never, review as never),
  };
});

import { ChatCartCheckoutReview } from './chat-cart-checkout-review';

const items = [
  {
    cartItemId: 'line-1',
    name: 'Phone',
    price: 500,
    quantity: 2,
    serverLineId: 'line-1',
  },
] as unknown as CartItem[];

function successfulReview(overrides: Record<string, unknown> = {}) {
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
          quantity: 2,
        },
      ],
      merchantId: 'merchant-1',
      subtotalMinor: 100_000,
      unavailableCount: 0,
      ...overrides,
    },
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    currencyCode: 'NGN',
    items,
    merchantId: 'merchant-1',
    merchantSlug: 'store',
    refreshSharedCart: vi.fn(),
    sharedCartEnabled: true,
    sharedCartRef: { cartId: 'cart-1', version: 2 },
    syncStatus: 'synced' as const,
    ...overrides,
  };
}

describe('ChatCartCheckoutReview', () => {
  beforeEach(() => {
    state.prepare.mockReset();
    state.reviewedItems = null;
  });

  it('renders the authoritative shared-cart review in the chat and invalidates cart or merchant drift', async () => {
    state.prepare.mockResolvedValue(successfulReview());
    const user = userEvent.setup();
    const view = render(<ChatCartCheckoutReview {...props()} />);

    await user.click(screen.getByRole('button', { name: 'Review checkout' }));

    expect(state.prepare).toHaveBeenCalledWith(
      {
        cartId: 'cart-1',
        expectedVersion: 2,
        operationId: expect.any(String),
      },
      'store'
    );
    expect(
      await screen.findByRole('region', { name: 'Authoritative checkout review' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 × ₦500.00')).toBeInTheDocument();
    expect(screen.getByText('Reviewed subtotal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /place order|pay now/i })).not.toBeInTheDocument();

    view.rerender(
      <ChatCartCheckoutReview
        {...props({ items: [{ ...items[0], name: 'Hydrated phone' }] })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('changed after this review');
    expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();

    view.rerender(
      <ChatCartCheckoutReview
        {...props({ sharedCartRef: { cartId: 'cart-1', version: 3 } })}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('changed after this review');
    expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();

    view.rerender(
      <ChatCartCheckoutReview {...props({ merchantId: 'another-merchant' })} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('changed after this review');
    expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();
  });

  it('does not prepare the review until the shared cart is synced', async () => {
    const user = userEvent.setup();
    render(<ChatCartCheckoutReview {...props({ syncStatus: 'pending' })} />);

    await user.click(screen.getByRole('button', { name: 'Review checkout' }));

    expect(state.prepare).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('still syncing');
  });

  it('rejects equal-count reviews whose line IDs do not match the display cart', async () => {
    state.prepare.mockResolvedValue(
      successfulReview({ lines: [{ ...successfulReview().review.lines[0], id: 'another-line' }] })
    );
    const refreshSharedCart = vi.fn();
    const user = userEvent.setup();
    render(<ChatCartCheckoutReview {...props({ refreshSharedCart })} />);

    await user.click(screen.getByRole('button', { name: 'Review checkout' }));

    expect(await screen.findByRole('status')).toHaveTextContent('cart or prices changed');
    expect(refreshSharedCart).toHaveBeenCalledOnce();
    expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();
  });

  it('rejects per-line price changes even when they cancel out in the subtotal', async () => {
    const twoItems = [
      { ...items[0], price: 500, quantity: 1 },
      { ...items[0], cartItemId: 'line-2', name: 'Case', price: 500, quantity: 1, serverLineId: 'line-2' },
    ] as CartItem[];
    state.reviewedItems = twoItems;
    state.prepare.mockResolvedValue(
      successfulReview({
        lines: [
          { ...successfulReview().review.lines[0], effectiveUnitPriceMinor: 60_000, quantity: 1 },
          { ...successfulReview().review.lines[0], id: 'line-2', effectiveUnitPriceMinor: 40_000, quantity: 1 },
        ],
        subtotalMinor: 100_000,
      })
    );
    const refreshSharedCart = vi.fn();
    const user = userEvent.setup();
    render(<ChatCartCheckoutReview {...props({ items: twoItems, refreshSharedCart })} />);

    await user.click(screen.getByRole('button', { name: 'Review checkout' }));

    expect(await screen.findByRole('status')).toHaveTextContent('cart or prices changed');
    expect(refreshSharedCart).toHaveBeenCalledOnce();
    expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();
  });

  it('reuses its operation id after an indeterminate response', async () => {
    state.prepare
      .mockResolvedValueOnce({
        code: 'temporarily_unavailable',
        currentVersion: null,
        ok: false,
        retryable: true,
      })
      .mockResolvedValueOnce(successfulReview());
    const user = userEvent.setup();
    render(<ChatCartCheckoutReview {...props()} />);
    const button = screen.getByRole('button', { name: 'Review checkout' });

    await user.click(button);
    await user.click(button);

    expect(state.prepare).toHaveBeenCalledTimes(2);
    expect(state.prepare.mock.calls[1]?.[0].operationId).toBe(
      state.prepare.mock.calls[0]?.[0].operationId
    );
    expect(
      screen.getByRole('region', { name: 'Authoritative checkout review' })
    ).toBeInTheDocument();
  });

  it('hides reviewed totals when the session expiry time passes', async () => {
    vi.useFakeTimers();
    try {
      state.prepare.mockResolvedValue({
        ...successfulReview(),
        sessionExpiresAtMonotonicMs: performance.now() + 5_000,
      });
      render(<ChatCartCheckoutReview {...props()} />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Review checkout' }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Reviewed subtotal')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5_001);
      });

      expect(screen.getByRole('status')).toHaveTextContent('review expired');
      expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates a review on resume when wall time passes its expiry', async () => {
    vi.useFakeTimers();
    try {
      state.prepare.mockResolvedValue({
        ...successfulReview(),
        sessionExpiresAtMonotonicMs: performance.now() + 5_000,
        sessionExpiresAtEpochMs: Date.now() + 5_000,
      });
      render(<ChatCartCheckoutReview {...props()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Review checkout' }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Reviewed subtotal')).toBeInTheDocument();

      vi.setSystemTime(Date.now() + 5_001);
      act(() => {
        window.dispatchEvent(new Event('pageshow'));
      });

      expect(screen.getByRole('status')).toHaveTextContent('review expired');
      expect(screen.queryByText('Reviewed subtotal')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed for mismatched and non-two-decimal currencies', async () => {
    state.prepare.mockResolvedValue(
      successfulReview({ currency: 'XOF', lines: [], subtotalMinor: 0 })
    );
    const user = userEvent.setup();
    const view = render(<ChatCartCheckoutReview {...props()} />);

    await user.click(screen.getByRole('button', { name: 'Review checkout' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'unavailable for this currency'
    );
    expect(
      screen.queryByRole('region', { name: 'Authoritative checkout review' })
    ).not.toBeInTheDocument();

    view.rerender(
      <ChatCartCheckoutReview {...props({ currencyCode: 'XOF' })} />
    );
    await user.click(screen.getByRole('button', { name: 'Review checkout' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'unavailable for this currency'
    );
  });
});
