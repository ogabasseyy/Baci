import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCriticalCartProduct } from './critical-cart-product';
import {
  OgabasseyPdpCriticalCommerceControls,
  OgabasseyPdpCriticalCommerceProvider,
  OgabasseyPdpCriticalCommerceSummary,
  OgabasseyPdpCriticalProductImage,
} from './critical-commerce.client';

const cartMocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  setIsCartOpen: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: cartMocks.addToCart,
    setIsCartOpen: cartMocks.setIsCartOpen,
  }),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({ alt, src }: { alt: string; src: string }) => (
    <img alt={alt} src={src} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

type CriticalCartInput = Parameters<typeof createCriticalCartProduct>[0];

function buildCriticalCartInput(
  overrides: Partial<CriticalCartInput> = {}
): CriticalCartInput {
  return {
    brand: 'OgaBassey',
    description: 'Flagship Phone',
    gtin: '',
    id: 'product-base',
    image: 'https://cdn.ogabassey.com/base.avif',
    imageHint: 'Flagship Phone',
    imageLarge: 'https://cdn.ogabassey.com/base.avif',
    manage_stock: true,
    mpn: 'FLAGSHIP',
    name: 'Flagship Phone',
    price: 550_000,
    slug: 'flagship-phone',
    status: 'active',
    stock: 4,
    ...overrides,
  };
}

describe('createCriticalCartProduct variant payload trimming', () => {
  beforeEach(() => {
    cartMocks.addToCart.mockClear();
    cartMocks.setIsCartOpen.mockClear();
  });

  it('strips unused variant metadata and redundant arrays to shrink RSC payloads', () => {
    const rawVariants = Array.from({ length: 40 }, (_, index) => ({
      attributes: {
        color: `Color ${index % 4}`,
        storage: `${128 * ((index % 4) + 1)}GB`,
        emptySpec: '   ',
      },
      available_units: null,
      condition: 'new' as const,
      cost_price: 450_000,
      effective_policy: 'off',
      id: `variant-${index}`,
      images: [
        `https://cdn.ogabassey.com/products/phone-${index}-1.avif`,
        `https://cdn.ogabassey.com/products/phone-${index}-2.avif`,
        `https://cdn.ogabassey.com/products/phone-${index}-3.avif`,
      ],
      inventory_items: [
        {
          id: `item-${index}`,
          identifier_type: 'IMEI',
          identifier_value: `35693803564380${index}`,
          status: 'available' as const,
          variant_id: `variant-${index}`,
        },
      ],
      inventory_tracking_policy: 'off',
      merchant_id: 'merchant-11111111-1111-1111-1111-111111111111',
      price_override: 550_000 + index * 5_000,
      primary_image: `https://cdn.ogabassey.com/products/phone-${index}-primary.avif`,
      product_id: 'product-22222222-2222-2222-2222-222222222222',
      sku: `SKU-PHONE-${index}`,
      stock_quantity: 5,
    }));

    const cartProduct = createCriticalCartProduct(
      buildCriticalCartInput({ has_variants: true, variants: rawVariants })
    );

    expect(cartProduct.variants?.[0]).toEqual({
      attributes: { color: 'Color 0', storage: '128GB' },
      condition: 'new',
      id: 'variant-0',
      price_override: 550_000,
      primary_image: 'https://cdn.ogabassey.com/products/phone-0-primary.avif',
      stock_quantity: 5,
    });
    expect(JSON.stringify(cartProduct.variants).length).toBeLessThan(
      JSON.stringify(rawVariants).length * 0.45
    );
  });

  it('collapses variant images[0] into primary_image when primary_image is absent', () => {
    const cartProduct = createCriticalCartProduct(
      buildCriticalCartInput({
        has_variants: true,
        variants: [
          {
            attributes: { color: 'Black' },
            id: 'variant-fallback-img',
            images: [
              'https://cdn.ogabassey.com/products/black-1.avif',
              'https://cdn.ogabassey.com/products/black-2.avif',
            ],
            merchant_id: 'merchant-1',
            product_id: 'product-base',
            stock_quantity: 3,
          },
        ],
      })
    );

    expect(cartProduct.variants?.[0]).toEqual({
      attributes: { color: 'Black' },
      id: 'variant-fallback-img',
      primary_image: 'https://cdn.ogabassey.com/products/black-1.avif',
      stock_quantity: 3,
    });
  });

  it('preserves active policies, zero overrides/units, and drops overridden off policies', () => {
    const base = {
      merchant_id: 'merchant-1',
      product_id: 'product-base',
      stock_quantity: 9,
    };
    const cartProduct = createCriticalCartProduct(
      buildCriticalCartInput({
        has_variants: true,
        variants: [
          {
            ...base,
            id: 'strict-variant',
            attributes: { storage: '128GB' },
            available_units: 2,
            effective_policy: 'serialized_strict',
            inventory_tracking_policy: 'off',
            price_override: 0,
          },
          {
            ...base,
            id: 'legacy-strict-variant',
            attributes: { storage: '256GB' },
            available_units: 0,
            inventory_tracking_policy: 'serialized_strict',
          },
          {
            ...base,
            id: 'unlimited-variant',
            attributes: { storage: '512GB' },
            inventory_tracking_policy: 'serialized_then_unlimited',
            stock_quantity: 0,
          },
          {
            ...base,
            id: 'overridden-off-variant',
            attributes: { storage: '1TB' },
            available_units: 2,
            effective_policy: 'off',
            inventory_tracking_policy: 'serialized_strict',
            stock_quantity: 5,
          },
        ],
      })
    );

    expect(cartProduct.variants).toEqual([
      {
        attributes: { storage: '128GB' },
        available_units: 2,
        effective_policy: 'serialized_strict',
        id: 'strict-variant',
        price_override: 0,
        stock_quantity: 9,
      },
      {
        attributes: { storage: '256GB' },
        available_units: 0,
        id: 'legacy-strict-variant',
        inventory_tracking_policy: 'serialized_strict',
        stock_quantity: 9,
      },
      {
        attributes: { storage: '512GB' },
        id: 'unlimited-variant',
        inventory_tracking_policy: 'serialized_then_unlimited',
        stock_quantity: 0,
      },
      {
        attributes: { storage: '1TB' },
        id: 'overridden-off-variant',
        stock_quantity: 5,
      },
    ]);
  });

  it('supports variant selection, image fallback switching, stock enforcement, and addToCart after trimming', () => {
    const trimmed = createCriticalCartProduct(
      buildCriticalCartInput({
        has_variants: true,
        manage_stock: true,
        variants: [
          {
            id: 'v-black-128',
            attributes: { color: 'Black', storage: '128GB' },
            condition: 'new',
            merchant_id: 'merchant-1',
            product_id: 'product-base',
            price_override: 550_000,
            primary_image: 'https://cdn.ogabassey.com/black.avif',
            stock_quantity: 4,
          },
          {
            id: 'v-silver-256',
            attributes: { color: 'Silver', storage: '256GB' },
            available_units: 2,
            condition: 'new',
            effective_policy: 'serialized_strict',
            images: ['https://cdn.ogabassey.com/silver-1.avif', 'https://cdn.ogabassey.com/silver-2.avif'],
            merchant_id: 'merchant-1',
            product_id: 'product-base',
            price_override: 690_000,
            stock_quantity: 7,
          },
        ],
      })
    );

    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={trimmed}
        variantAxes={['storage', 'color']}
        variantCount={2}
      >
        <OgabasseyPdpCriticalProductImage alt={trimmed.name} fallbackImage={trimmed.image} />
        <OgabasseyPdpCriticalCommerceSummary />
        <OgabasseyPdpCriticalCommerceControls cartHref="/cart" productName={trimmed.name} />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByRole('img', { name: trimmed.name })).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/black.avif'
    );

    fireEvent.click(screen.getByRole('button', { name: /select 256gb storage/i }));
    fireEvent.click(screen.getByRole('button', { name: /select silver color/i }));

    expect(screen.getByText(/690,000/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: trimmed.name })).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/silver-1.avif'
    );

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'product-base',
        image: 'https://cdn.ogabassey.com/silver-1.avif',
        price: 690_000,
        stock: 2,
      }),
      1,
      expect.objectContaining({ color: 'Silver', storage: '256GB', variantId: 'v-silver-256' })
    );
    expect(cartMocks.addToCart.mock.calls[0]?.[0]).not.toHaveProperty('variants');
  });
});
