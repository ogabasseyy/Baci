import { projectChatwootProductCard } from './product-card-projection';

export const merchantId = '11111111-1111-4111-8111-111111111111';
export const productId = '22222222-2222-4222-8222-222222222222';
export const variantId = '33333333-3333-4333-8333-333333333333';

export function product(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    merchant_id: merchantId,
    slug: 'phone-15',
    name: 'Phone 15',
    status: 'active',
    price: 300_000,
    has_variants: false,
    has_condition_offers: false,
    manage_stock: true,
    stock_quantity: 4,
    stock: 4,
    images: ['https://cdn.example.test/phone.jpg'],
    condition: 'used',
    variants_truncated: false,
    product_variants: [],
    ...overrides,
  };
}

export function project(value: unknown) {
  return projectChatwootProductCard({
    currency: 'NGN',
    merchantId,
    product: value,
    requestedSlug: 'phone-15',
  });
}
