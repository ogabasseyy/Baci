import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpProductViewTracker } from './product-view-tracker.client';

const { mockUseMerchantSafe } = vi.hoisted(() => ({
  mockUseMerchantSafe: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mockUseMerchantSafe,
}));

const productView = vi.fn();
const loadTracker = vi.fn(async () => ({ trackEvent: { productView } }) as never);

describe('bugfix: ogabassey product page never reported product_view', () => {
  beforeEach(() => {
    productView.mockClear();
    loadTracker.mockClear();
    mockUseMerchantSafe.mockReturnValue({
      merchant: { id: 'merchant-1', country: 'NG', payout_currency: null },
    });
  });

  it('reports one product_view with the merchant currency', async () => {
    render(
      <OgabasseyPdpProductViewTracker
        productId="prod-1"
        name="iPhone 15 Pro"
        price={1_250_000}
        category="Phones"
        loadTracker={loadTracker}
      />
    );

    await vi.waitFor(() => expect(productView).toHaveBeenCalledTimes(1));
    expect(productView).toHaveBeenCalledWith(
      'merchant-1',
      { id: 'prod-1', name: 'iPhone 15 Pro', price: 1_250_000, category: 'Phones' },
      'NGN'
    );
  });

  it('does not report again when the same product re-renders', async () => {
    const { rerender } = render(
      <OgabasseyPdpProductViewTracker
        productId="prod-1"
        name="iPhone 15 Pro"
        price={1_250_000}
        loadTracker={loadTracker}
      />
    );
    await vi.waitFor(() => expect(productView).toHaveBeenCalledTimes(1));

    rerender(
      <OgabasseyPdpProductViewTracker
        productId="prod-1"
        name="iPhone 15 Pro"
        price={1_250_000}
        loadTracker={loadTracker}
      />
    );
    await Promise.resolve();

    expect(productView).toHaveBeenCalledTimes(1);
  });

  it('reports again when the shopper moves to a different product', async () => {
    const { rerender } = render(
      <OgabasseyPdpProductViewTracker
        productId="prod-1"
        name="iPhone 15 Pro"
        price={1_250_000}
        loadTracker={loadTracker}
      />
    );
    await vi.waitFor(() => expect(productView).toHaveBeenCalledTimes(1));

    rerender(
      <OgabasseyPdpProductViewTracker
        productId="prod-2"
        name="Galaxy S24"
        price={950_000}
        loadTracker={loadTracker}
      />
    );

    await vi.waitFor(() => expect(productView).toHaveBeenCalledTimes(2));
    expect(productView).toHaveBeenLastCalledWith(
      'merchant-1',
      expect.objectContaining({ id: 'prod-2' }),
      'NGN'
    );
  });

  it('waits for prerender activation before reporting', async () => {
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: true,
    });
    try {
      render(
        <OgabasseyPdpProductViewTracker
          productId="prod-1"
          name="iPhone 15 Pro"
          price={1_250_000}
          loadTracker={loadTracker}
        />
      );
      await Promise.resolve();
      expect(loadTracker).not.toHaveBeenCalled();

      Object.defineProperty(document, 'prerendering', {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event('prerenderingchange'));

      await vi.waitFor(() => expect(productView).toHaveBeenCalledTimes(1));
    } finally {
      Reflect.deleteProperty(document, 'prerendering');
    }
  });

  it('does nothing without a merchant', async () => {
    mockUseMerchantSafe.mockReturnValue(null);

    render(
      <OgabasseyPdpProductViewTracker
        productId="prod-1"
        name="iPhone 15 Pro"
        price={1_250_000}
        loadTracker={loadTracker}
      />
    );
    await Promise.resolve();

    expect(loadTracker).not.toHaveBeenCalled();
  });
});
