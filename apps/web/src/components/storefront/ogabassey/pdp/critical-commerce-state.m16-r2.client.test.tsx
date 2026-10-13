import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct, ProductVariant } from '@/lib/products';
import {
  OgabasseyPdpCriticalCommerceProvider,
  useOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state.client';

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

const baseCartProduct: CartProduct = {
  brand: 'Alienware',
  condition: 'used',
  description: 'Alienware M16 R2',
  gtin: '',
  has_variants: true,
  id: 'alienware-m16-r2',
  image: 'https://cdn.ogabassey.com/alienware-m16-r2.avif',
  imageHint: 'Alienware M16 R2',
  imageLarge: 'https://cdn.ogabassey.com/alienware-m16-r2.avif',
  manage_stock: false,
  mpn: 'alienware-m16-r2',
  name: 'Alienware M16 R2',
  price: 2_145_000,
  status: 'active',
  stock: 0,
};

function CriticalCommerceStateProbe() {
  const commerce = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <p>{commerce.productForCart.price}</p>
      <p>{commerce.canAddToCart ? 'ready' : 'blocked'}</p>
      <p>axes:{commerce.renderableVariantAxes.join(',')}</p>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'used')}
        type="button"
      >
        Select used condition
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('ram', '16GB')}
        type="button"
      >
        Select 16GB RAM
      </button>
      <button
        onClick={() =>
          commerce.handleAttributeSelection(
            'processor',
            'Intel Core Ultra 7 155H'
          )
        }
        type="button"
      >
        Select Intel Core Ultra 7 processor
      </button>
      <button
        disabled={!commerce.canAddToCart}
        onClick={commerce.handleAddToCart}
        type="button"
      >
        Add to cart
      </button>
    </>
  );
}

beforeEach(() => {
  cartMocks.addToCart.mockClear();
  cartMocks.setIsCartOpen.mockClear();
});

describe('OgabasseyPdpCriticalCommerceProvider M16 R2 deep link', () => {
  it('lets an M16 R2 deep link switch variants without metadata locking the matrix', () => {
    const m16Variants: ProductVariant[] = [
      {
        attributes: {
          camera: 'Webcam',
          graphics: '8GB RTX 4070 Graphics',
          keyboard: 'Backlit keyboard',
          model_number: 'DYMSR54',
          operating_system: 'Windows 11 Pro',
          processor: 'Intel Ultra 7 155H',
          ram: '16GB RAM',
          storage: '1TB SSD',
        },
        condition: 'used' as const,
        id: 'm16-used-16',
        merchant_id: 'merchant-1',
        price_override: 2_145_000,
        product_id: 'alienware-m16-r2',
        stock_quantity: 0,
      },
      {
        attributes: {
          camera: 'Webcam',
          graphics: '8GB NVIDIA RTX 4070 Graphics',
          keyboard: 'Backlit keyboard',
          model_number: 'M16-R2',
          operating_system: 'Windows 11 Home',
          processor: 'Intel Ultra 9 185H',
          ram: '32GB RAM',
          storage: '1TB SSD',
        },
        condition: 'used' as const,
        id: 'm16-used-32',
        merchant_id: 'merchant-1',
        price_override: 2_420_000,
        product_id: 'alienware-m16-r2',
        stock_quantity: 0,
      },
      {
        attributes: {
          camera: 'Webcam',
          graphics: '8GB NVIDIA GeForce RTX 4070 Graphics',
          keyboard: 'Backlit keyboard',
          model_number: 'DYMSR54',
          operating_system: 'Windows 11 Pro',
          processor: 'Intel Core Ultra 7 155H',
          ram: '64GB RAM',
          storage: '1TB SSD',
          wireless: 'WLAN and Bluetooth',
        },
        condition: 'new' as const,
        id: 'm16-new-64',
        merchant_id: 'merchant-1',
        price_override: 4_330_000,
        product_id: 'alienware-m16-r2',
        stock_quantity: 0,
      },
    ];

    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={{
          ...baseCartProduct,
          variants: m16Variants,
        }}
        initialVariantSelection={{
          attributes: m16Variants[2]?.attributes ?? {},
          condition: 'new',
          variantId: 'm16-new-64',
        }}
        variantAxes={[
          'condition',
          'ram',
          'processor',
          'storage',
          'camera',
          'keyboard',
          'operating_system',
          'model_number',
        ]}
        variantCount={3}
      >
        <CriticalCommerceStateProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByText('axes:condition,ram,processor')).toBeInTheDocument();
    expect(screen.getByText('4330000')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /select used condition/i })
    );
    expect(screen.getByText('blocked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /select 16gb ram/i }));
    expect(screen.getByText('2145000')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /select intel core ultra 7 processor/i,
      })
    );
    expect(screen.getByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 2_145_000 }),
      1,
      expect.objectContaining({ variantId: 'm16-used-16' })
    );
  });
});
