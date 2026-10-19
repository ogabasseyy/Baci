import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: mockApiPost,
}));

import { SelectedShippingDisplay, ShippingOptions } from './shipping-options';

const merchantRateQuote: ShippingQuote = {
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000001',
  provider: 'MERCHANT',
  serviceTier: 'standard',
  carrierName: 'Standard Delivery',
  displayName: 'Standard Delivery',
  estimatedDays: 3,
  price: 1000,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
};

const cheapQuote: ShippingQuote = {
  id: 'quote-cheap',
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 2,
  price: 1500,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: false,
};

const expensiveQuote: ShippingQuote = {
  id: 'quote-expensive',
  provider: 'TOPSHIP',
  serviceTier: 'express',
  carrierName: 'Topship Express',
  displayName: 'Topship Express',
  estimatedDays: 1,
  price: 4000,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: true,
};

const quotesResponse = {
  quotes: { featured: [cheapQuote], all: [cheapQuote, expensiveQuote] },
  sessionId: 'session-1',
  expiresAt: '2026-06-12T00:00:00.000Z',
};

const baseProps = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  receiverCity: 'Lagos',
  receiverState: 'Lagos',
  receiverAddress: '1 Marina Road',
  receiverPhone: '08000000000',
  receiverName: 'Ada',
  cartItems: [{ name: 'Pixel 9', quantity: 2, price: 5000 }],
  // Includes the assurance fee calculated from the complete checkout cart.
  cartSubtotal: 10500,
};

describe('ShippingOptions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiPost.mockReset();
    mockApiPost.mockResolvedValue(quotesResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prompts for an address before any quotes are fetched', () => {
    render(
      <ShippingOptions {...baseProps} receiverCity="" onSelect={vi.fn()} />
    );

    expect(
      screen.getByText('Enter your address to see shipping options')
    ).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('does not fetch quotes before the merchant id is available', async () => {
    render(<ShippingOptions {...baseProps} merchantId="" onSelect={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('fetches quotes after the debounce and auto-selects the cheapest option', async () => {
    const onSelect = vi.fn();

    render(<ShippingOptions {...baseProps} onSelect={onSelect} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/shipping/quotes',
      {
        merchantId: '11111111-1111-4111-8111-111111111111',
        receiver: {
          name: 'Ada',
          phone: '08000000000',
          address: '1 Marina Road',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        items: [{ name: 'Pixel 9', quantity: 2, weight: 1, value: 5000 }],
        shipmentType: 'domestic',
        // The canonical subtotal includes assurance, so merchant-rate thresholds
        // match the order-time validation basis.
        cart_subtotal: 10500,
        supports_merchant_rates: true,
      },
      {
        headers: { 'x-baci-client': 'web-storefront' },
      }
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(cheapQuote, 'session-1');
    expect(screen.getByText('GIG Logistics')).toBeInTheDocument();
    expect(screen.getByText('Topship Express')).toBeInTheDocument();
  });

  it('does not refetch quotes when only the onSelect identity changes', async () => {
    const { rerender } = render(
      <ShippingOptions {...baseProps} onSelect={vi.fn()} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    rerender(<ShippingOptions {...baseProps} onSelect={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it('refetches merchant rates when the canonical cart subtotal changes', async () => {
    const { rerender } = render(
      <ShippingOptions {...baseProps} onSelect={vi.fn()} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    rerender(
      <ShippingOptions
        {...{ ...baseProps, cartSubtotal: 12000 }}
        onSelect={vi.fn()}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(mockApiPost).toHaveBeenLastCalledWith(
      '/api/shipping/quotes',
      expect.objectContaining({ cart_subtotal: 12000 }),
      { headers: { 'x-baci-client': 'web-storefront' } }
    );
  });

  it('re-selects from each fresh response when the address changes', async () => {
    const onSelect = vi.fn();
    mockApiPost.mockResolvedValueOnce(quotesResponse).mockResolvedValueOnce({
      quotes: { featured: [expensiveQuote], all: [expensiveQuote] },
      sessionId: 'session-2',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });

    const { rerender } = render(
      <ShippingOptions {...baseProps} onSelect={onSelect} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onSelect).toHaveBeenCalledWith(cheapQuote, 'session-1');

    rerender(
      <ShippingOptions
        {...baseProps}
        receiverCity="Abuja"
        selectedQuoteId="quote-cheap"
        onSelect={onSelect}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(expensiveQuote, 'session-2');
  });

  it('clears the parent selection when the fresh response has no quotes', async () => {
    const onSelect = vi.fn();
    mockApiPost.mockResolvedValueOnce(quotesResponse).mockResolvedValueOnce({
      quotes: { featured: [], all: [] },
      sessionId: 'session-2',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });

    const { rerender } = render(
      <ShippingOptions {...baseProps} onSelect={onSelect} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onSelect).toHaveBeenCalledWith(cheapQuote, 'session-1');

    rerender(
      <ShippingOptions
        {...baseProps}
        receiverCity="Abuja"
        selectedQuoteId="quote-cheap"
        onSelect={onSelect}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(null, '');
  });

  it('clears the parent selection when a refresh request fails', async () => {
    const onSelect = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockApiPost
      .mockResolvedValueOnce(quotesResponse)
      .mockRejectedValueOnce(new Error('network down'));

    try {
      const { rerender } = render(
        <ShippingOptions {...baseProps} onSelect={onSelect} />
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(onSelect).toHaveBeenCalledWith(cheapQuote, 'session-1');

      rerender(
        <ShippingOptions
          {...baseProps}
          receiverCity="Abuja"
          selectedQuoteId="quote-cheap"
          onSelect={onSelect}
        />
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockApiPost).toHaveBeenCalledTimes(2);
      expect(onSelect).toHaveBeenLastCalledWith(null, '');
      expect(
        screen.getByText('Unable to get shipping options. Please try again.')
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows and selects merchant-configured rates the checkout can now submit', async () => {
    mockApiPost.mockResolvedValue({
      quotes: { featured: [cheapQuote], all: [merchantRateQuote, cheapQuote] },
      sessionId: 'session-mixed',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });
    const onSelect = vi.fn();

    render(<ShippingOptions {...baseProps} onSelect={onSelect} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText('GIG Logistics')).toBeInTheDocument();
    expect(screen.getByText('Standard Delivery')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(merchantRateQuote, 'session-mixed');
  });

  it('renders a merchant-configured rate when it is the only available option', async () => {
    mockApiPost.mockResolvedValue({
      quotes: { featured: [merchantRateQuote], all: [merchantRateQuote] },
      sessionId: 'session-merchant',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });
    const onSelect = vi.fn();

    render(<ShippingOptions {...baseProps} onSelect={onSelect} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText('Standard Delivery')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(
      merchantRateQuote,
      'session-merchant'
    );
  });

  it('renders an unavailable ETA instead of zero days for merchant rates', async () => {
    mockApiPost.mockResolvedValue({
      quotes: {
        featured: [
          { ...merchantRateQuote, estimatedDays: 0, deliveryRange: undefined },
        ],
        all: [
          { ...merchantRateQuote, estimatedDays: 0, deliveryRange: undefined },
        ],
      },
      sessionId: 'session-unknown-eta',
      expiresAt: '2026-06-12T00:00:00.000Z',
    });

    render(<ShippingOptions {...baseProps} onSelect={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText('ETA unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0 days')).not.toBeInTheDocument();
  });

  it('keeps an unavailable ETA out of the selected shipping summary', () => {
    render(
      <SelectedShippingDisplay
        quote={{
          ...merchantRateQuote,
          estimatedDays: 0,
          deliveryRange: undefined,
        }}
      />
    );

    expect(screen.getByText('ETA unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/0 business days/)).not.toBeInTheDocument();
  });

  it('shows a retry message when the quote request fails', async () => {
    mockApiPost.mockRejectedValue(new Error('network down'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      render(<ShippingOptions {...baseProps} onSelect={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(
        screen.getByText('Unable to get shipping options. Please try again.')
      ).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
