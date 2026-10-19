import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { OgabasseyPdpCriticalCommerceSummary } from './critical-commerce.client';
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

const simpleCartProduct: CartProduct = {
  brand: 'Xiaomi',
  condition: 'new',
  description: 'Redmi Pad 2',
  gtin: '',
  has_variants: false,
  id: 'redmi-pad-2',
  image: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  imageHint: 'Redmi Pad 2',
  imageLarge: 'https://cdn.ogabassey.com/redmi-pad-2.avif',
  manage_stock: true,
  mpn: 'redmi-pad-2',
  name: 'Redmi Pad 2',
  price: 100,
  status: 'active',
  stock: 10,
  offers: [
    { id: 'offer-new', condition: 'new', price: 100, stock_quantity: 10 },
    { id: 'offer-used', condition: 'used', price: 60, stock_quantity: 3 },
  ],
};

const variantCartProduct: CartProduct = {
  ...simpleCartProduct,
  has_variants: true,
  variants: [
    {
      attributes: { storage: '128GB' },
      id: 'variant-128',
      merchant_id: 'merchant-1',
      price_override: 120,
      product_id: 'redmi-pad-2',
      stock_quantity: 10,
    },
  ],
};

function RouteOfferProbe() {
  const commerce = useOgabasseyPdpCriticalCommerce();

  return (
    <>
      <p>price:{commerce.productForCart.price}</p>
      <p>condition:{commerce.productForCart.condition}</p>
      <p>max:{String(commerce.maxQuantity)}</p>
      <p>{commerce.canAddToCart ? 'ready' : 'blocked'}</p>
      <p>{commerce.routeOfferMissingActive ? 'missing' : 'found'}</p>
      <button onClick={() => commerce.handleAddToCart()} type="button">
        Add
      </button>
      <button
        onClick={() => commerce.handleAttributeSelection('condition', 'new')}
        type="button"
      >
        Select new condition
      </button>
    </>
  );
}

function renderProvider(
  cartProduct: CartProduct,
  props: {
    initialOfferId?: string | null;
    routeOfferMissing?: boolean;
    initialVariantSelection?: { condition?: string };
  } = {}
) {
  return render(
    <OgabasseyPdpCriticalCommerceProvider
      cartProduct={cartProduct}
      initialVariantSelection={props.initialVariantSelection}
      initialOfferId={props.initialOfferId}
      routeOfferMissing={props.routeOfferMissing}
      variantAxes={[]}
      variantAxisOptions={{}}
      variantCount={0}
    >
      <RouteOfferProbe />
    </OgabasseyPdpCriticalCommerceProvider>
  );
}

describe('critical commerce route offers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prices the buy box from the pinned route offer', () => {
    renderProvider(simpleCartProduct, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-used',
    });

    expect(screen.getByText('price:60')).toBeInTheDocument();
    expect(screen.getByText('condition:used')).toBeInTheDocument();
    expect(screen.getByText('max:3')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('forwards the exact offer id into the cart add', () => {
    renderProvider(simpleCartProduct, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-used',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 60, condition: 'used' }),
      1,
      { condition: 'used', offerId: 'offer-used' }
    );
  });

  it('enforces a zero-stock pinned offer as unpurchasable', () => {
    const soldOut: CartProduct = {
      ...simpleCartProduct,
      offers: [
        { id: 'offer-used', condition: 'used', price: 60, stock_quantity: 0 },
      ],
    };
    renderProvider(soldOut, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-used',
    });

    expect(screen.getByText('max:0')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
  });

  it('blocks purchase on a missing offer until a condition is picked', () => {
    renderProvider(simpleCartProduct, { routeOfferMissing: true });

    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select new condition' })
    );

    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('found')).toBeInTheDocument();
  });

  it('announces the missing offer above the critical price', () => {
    render(
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={simpleCartProduct}
        routeOfferMissing
        variantAxes={[]}
        variantAxisOptions={{}}
        variantCount={0}
      >
        <OgabasseyPdpCriticalCommerceSummary />
      </OgabasseyPdpCriticalCommerceProvider>
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/no longer available/);
  });

  it('drops the pin when the shopper picks another condition', () => {
    renderProvider(simpleCartProduct, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-used',
    });
    expect(screen.getByText('price:60')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select new condition' })
    );

    expect(screen.getByText('price:100')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.not.objectContaining({ offerId: expect.anything() })
    );
  });

  it('lets a resolved variant selection win over the pin', () => {
    renderProvider(variantCartProduct, { initialOfferId: 'offer-used' });

    expect(screen.getByText('price:120')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.not.objectContaining({ offerId: expect.anything() })
    );
  });

  it('ignores an unknown pinned offer id', () => {
    renderProvider(simpleCartProduct, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-gone',
    });

    expect(screen.getByText('price:100')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('caps the pinned allocation by the strict base pool', () => {
    const strictProduct: CartProduct = {
      ...simpleCartProduct,
      inventory_tracking_policy: 'serialized_strict',
      stock: 2,
      stock_quantity: 2,
      offers: [
        {
          id: 'offer-big',
          condition: 'used',
          price: 60,
          stock_quantity: 5,
        },
      ],
    };
    renderProvider(strictProduct, {
      initialVariantSelection: { condition: 'used' },
      initialOfferId: 'offer-big',
    });

    expect(screen.getByText('max:2')).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('resets the dismissal when the route offer changes', () => {
    const renderProps = (initialOfferId: string | null) => (
      <OgabasseyPdpCriticalCommerceProvider
        cartProduct={simpleCartProduct}
        initialVariantSelection={{ condition: 'used' }}
        initialOfferId={initialOfferId}
        variantAxes={[]}
        variantAxisOptions={{}}
        variantCount={0}
      >
        <RouteOfferProbe />
      </OgabasseyPdpCriticalCommerceProvider>
    );
    const { rerender } = render(renderProps('offer-used'));
    expect(screen.getByText('price:60')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select new condition' })
    );
    expect(screen.getByText('price:100')).toBeInTheDocument();

    // Client-side navigation to a fresh deep link re-arms the pin even
    // though the provider instance stays mounted: offer-new matches the
    // selected condition, so the dismissal reset forwards it again.
    rerender(renderProps('offer-new'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(cartMocks.addToCart).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ offerId: 'offer-new' })
    );
  });
});
