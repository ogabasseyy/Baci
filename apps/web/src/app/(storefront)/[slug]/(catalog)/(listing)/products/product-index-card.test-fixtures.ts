import type { NormalizedProduct } from '@/lib/normalize-product';

export function makeProduct(
  overrides: Partial<NormalizedProduct> = {}
): NormalizedProduct {
  return {
    id: 'product-1',
    name: 'iPhone 13 Pro',
    slug: 'iphone-13-pro',
    description: 'Phone',
    image: 'https://example.com/iphone.jpg',
    imageLarge: 'https://example.com/iphone.jpg',
    images: ['https://example.com/iphone.jpg'],
    category: 'Phones',
    category_slug: 'phones',
    brand: 'Apple',
    price: 550000,
    compare_at_price: null,
    condition: 'new',
    stock: 10,
    manage_stock: true,
    rating: 4.5,
    availability: 'InStock',
    available_conditions: [],
    variant_model: 'legacy',
    ...overrides,
  };
}
