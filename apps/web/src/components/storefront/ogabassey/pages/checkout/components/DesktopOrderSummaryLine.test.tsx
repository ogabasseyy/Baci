// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  type CheckoutItem,
  DesktopOrderSummaryLine,
} from './DesktopOrderSummaryLine';

const cartItem: Extract<CheckoutItem, { kind: 'cart' }> = {
  kind: 'cart',
  id: 'synthetic-product',
  cartItemId: 'synthetic-line',
  variantId: 'synthetic-variant',
  quantity: 3,
  name: 'Synthetic device',
  status: 'active',
  description: '',
  price: 250,
  manage_stock: false,
  stock: 0,
  image: '',
  imageLarge: '',
  imageHint: '',
  brand: '',
  gtin: '',
  mpn: '',
};

it('renders native verification attributes for the cart line', () => {
  const html = renderToStaticMarkup(
    <DesktopOrderSummaryLine item={cartItem} formatCurrencyAuto={String} />
  );
  expect(html).toContain('data-baci-checkout-product="synthetic-product"');
  expect(html).toContain('data-baci-checkout-variant="synthetic-variant"');
  expect(html).toContain('data-baci-checkout-quantity="3"');
  expect(html).toContain('Synthetic device');
  expect(html).toContain('Qty: 3');
});

it('keeps the empty variant marker for products without variants', () => {
  const html = renderToStaticMarkup(
    <DesktopOrderSummaryLine
      item={{ ...cartItem, variantId: undefined }}
      formatCurrencyAuto={String}
    />
  );
  expect(html).toContain('data-baci-checkout-variant=""');
});

it('renders resumed orders without native cart verification attributes', () => {
  const html = renderToStaticMarkup(
    <DesktopOrderSummaryLine
      item={{
        kind: 'resumed',
        id: 'resumed-line',
        product_id: 'synthetic-product',
        product_name: 'Resumed device',
        quantity: 1,
        price: 250,
      }}
      formatCurrencyAuto={String}
    />
  );
  expect(html).toContain('Resumed device');
  expect(html).not.toContain('data-baci-checkout-');
});
