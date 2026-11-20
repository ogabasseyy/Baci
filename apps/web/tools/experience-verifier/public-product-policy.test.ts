import { expect, it } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { createPublicProductPolicy } from './public-product-policy';

const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://project.supabase.co';
const url = new URL(`${origin}/rest/v1/products`);
url.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
url.searchParams.set('merchant_id', `eq.${merchantId}`);
url.searchParams.set('id', `in.(${productId})`);
url.searchParams.set('status', 'eq.active');

it('allows only the selected product hydration read for the bound merchant', () => {
  const allows = createPublicProductPolicy({ origin, merchantId, productId });
  expect(allows({ url: url.href, method: 'GET' })).toBe(true);
  const otherProduct = new URL(url);
  otherProduct.searchParams.set(
    'id',
    'in.(44444444-4444-4444-8444-444444444444)'
  );
  const otherMerchant = new URL(url);
  otherMerchant.searchParams.set(
    'merchant_id',
    'eq.44444444-4444-4444-8444-444444444444'
  );
  const extra = new URL(url);
  extra.searchParams.append('status', 'eq.inactive');
  const allColumns = new URL(url);
  allColumns.searchParams.set('select', '*');
  for (const value of [
    otherProduct,
    otherMerchant,
    extra,
    allColumns,
    new URL(url.href.replace('project.supabase.co', 'other.supabase.co')),
  ])
    expect(allows({ url: value.href, method: 'GET' })).toBe(false);
  expect(allows({ url: url.href, method: 'POST' })).toBe(false);
});
