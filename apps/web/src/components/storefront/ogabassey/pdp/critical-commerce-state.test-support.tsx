import type { Product as CartProduct } from '@/lib/products';
import { useOgabasseyPdpCriticalCommerce } from './critical-commerce-state.client';

export const variantCartProduct: CartProduct = {
  brand: 'Xiaomi',
  condition: 'new',
  description: 'Redmi Pad 2',
  gtin: '',
  has_variants: true,
  id: 'redmi-pad-2',
  image: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  imageHint: 'Redmi Pad 2',
  imageLarge: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  manage_stock: true,
  mpn: 'redmi-pad-2',
  name: 'Redmi Pad 2',
  price: 237_674.42,
  status: 'active',
  stock: 10,
  variants: [
    {
      attributes: { ram: '4GB', storage: '128GB' },
      id: 'variant-128-4',
      merchant_id: 'merchant-1',
      price_override: 237_674.42,
      product_id: 'redmi-pad-2',
      stock_quantity: 10,
    },
    {
      attributes: { ram: '8GB', storage: '256GB' },
      id: 'variant-256-8',
      merchant_id: 'merchant-1',
      price_override: 278_418.6,
      product_id: 'redmi-pad-2',
      stock_quantity: 8,
    },
  ],
};

export function CriticalCommerceStateProbe() {
  const commerce = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <p>{commerce.productForCart.price}</p>
      <p>currency:{commerce.currency.code}</p>
      <p>in cart:{commerce.quantityInCart}</p>
      <p>max:{commerce.maxQuantity ?? 'none'}</p>
      <p>at max:{String(commerce.isAtMaxQuantity)}</p>
      <p>{commerce.canAddToCart ? 'ready' : 'blocked'}</p>
      <p>axes:{commerce.renderableVariantAxes.join(',')}</p>
      <p>explicit axes:{commerce.explicitSelectedAxes.join(',')}</p>
      <p>selected condition:{commerce.selectedAttributes.condition || ''}</p>
      <p>selected storage:{commerce.selectedAttributes.storage || ''}</p>
      <p>selected ram:{commerce.selectedAttributes.ram || ''}</p>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'new')}
        type="button"
      >
        Select new condition
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'used')}
        type="button"
      >
        Select used condition
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('storage', '256GB')}
        type="button"
      >
        Select 256GB storage
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('ram', '16GB')}
        type="button"
      >
        Select 16GB RAM
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('ram', '8GB')}
        type="button"
      >
        Select 8GB RAM
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
