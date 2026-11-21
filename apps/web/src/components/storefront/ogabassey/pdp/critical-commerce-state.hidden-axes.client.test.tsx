import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OgabasseyPdpCriticalCommerceProvider } from './critical-commerce-state.client';
import {
  CriticalCommerceStateProbe,
  variantCartProduct,
} from './critical-commerce-state.test-support';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
  cart: [] as Array<{ quantity: number } & Record<string, unknown>>,
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    cart: cartMocks.cart,
    setIsCartOpen: cartMocks.setIsCartOpen,
  }),
}));

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
  cartMocks.cart = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('OgabasseyPdpCriticalCommerceProvider hidden and fixed axes', () => {
  it('uses a top-level route condition when the condition axis is hidden', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          condition: 'new',
          price: 552_000,
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              id: 'variant-used-128',
              merchant_id: 'merchant-1',
              price_override: 500_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 3,
            },
            {
              attributes: { storage: '256GB' },
              id: 'variant-new-256',
              merchant_id: 'merchant-1',
              price_override: 552_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 5,
            },
          ],
        }}
        initialVariantSelection={{ condition: 'used' }}
        variantAxes={['storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:storage')).toBeInTheDocument();
    expect(screen.getByText('selected condition:used')).toBeInTheDocument();
    expect(screen.getByText('selected storage:128GB')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        condition: 'used',
        price: 500_000,
        stock: 3,
      }),
      1,
      expect.objectContaining({
        condition: 'used',
        storage: '128GB',
        variantId: 'variant-used-128',
      })
    );
  });

  it('does not satisfy hidden condition axes with malformed route conditions', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          condition: 'new',
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              id: 'variant-used-128',
              merchant_id: 'merchant-1',
              price_override: 500_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 3,
            },
            {
              attributes: { storage: '256GB' },
              id: 'variant-new-256',
              merchant_id: 'merchant-1',
              price_override: 552_000,
              product_id: 'redmi-pad-2',
              stock_quantity: 5,
            },
          ],
        }}
        initialVariantSelection={{ condition: '   ' }}
        variantAxes={['storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:storage')).toBeInTheDocument();
    expect(screen.getByText('explicit axes:')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('exposes required color-only axes without preselecting a colour', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: [
            {
              attributes: { color: 'Black' },
              id: 'variant-black',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
            {
              attributes: { color: 'Blue' },
              id: 'variant-blue',
              merchant_id: 'merchant-1',
              price_override: 278_418.6,
              product_id: 'redmi-pad-2',
              stock_quantity: 6,
            },
          ],
        }}
        variantAxes={[]}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:color')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('warns in development when a hidden required axis is missing upstream selection', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: [
            {
              attributes: { connectivity: 'Black' },
              id: 'variant-black',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
            {
              attributes: { connectivity: 'Blue' },
              id: 'variant-blue',
              merchant_id: 'merchant-1',
              price_override: 278_418.6,
              product_id: 'redmi-pad-2',
              stock_quantity: 6,
            },
          ],
        }}
        variantAxes={[]}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('blocked')).toBeInTheDocument();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[Ogabassey PDP] Missing hidden required variant selection.',
        {
          axes: ['connectivity'],
          productId: 'redmi-pad-2',
        }
      );
    });
  });

  it('does not render fixed axes from the default SKU as choices and uses fixed metadata cleanly', () => {
    const { rerender } = render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: [
            {
              attributes: { color: 'Black', storage: '128GB' },
              id: 'variant-black',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
            {
              attributes: { color: 'Blue', storage: '128GB' },
              id: 'variant-blue',
              merchant_id: 'merchant-1',
              price_override: 278_418.6,
              product_id: 'redmi-pad-2',
              stock_quantity: 6,
            },
          ],
        }}
        variantAxes={['storage']}
        variantCount={2}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:color')).toBeInTheDocument();
    expect(screen.getByText('selected storage:')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();

    rerender(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...variantCartProduct,
          variants: [
            {
              attributes: {},
              id: 'variant-black',
              merchant_id: 'merchant-1',
              price_override: 237_674.42,
              product_id: 'redmi-pad-2',
              stock_quantity: 4,
            },
          ],
        }}
        variantAxes={['storage']}
        variantAxisOptions={{ storage: ['128GB'] }}
        variantCount={1}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:')).toBeInTheDocument();
    expect(screen.getByText('selected storage:')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });
});
