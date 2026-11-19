export const mockProductIndex = {
  hasError: false,
  products: [
    {
      id: 'product-1',
      name: 'iPhone 16',
      slug: 'iphone-16',
      description: 'Phone description',
      image: 'https://cdn.example.com/iphone-16.png',
      imageLarge: 'https://cdn.example.com/iphone-16.png',
      images: ['https://cdn.example.com/iphone-16.png'],
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 1200000,
      compare_at_price: null,
      condition: 'new',
      stock: 5,
      manage_stock: true,
      rating: 0,
      availability: 'InStock' as const,
      available_conditions: [],
      variant_model: 'legacy' as const,
    },
  ],
  totalCount: 21,
  totalPages: 2,
};

export const mockMerchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'test-store',
  custom_domain: null,
  payout_currency: 'NGN',
  site_description: 'Store description',
};

export const mockCategories = [
  {
    id: 'cat-1',
    name: 'Smartphones',
    slug: 'smartphones',
    description: null,
    image_url: null,
    is_active: true,
    parent_id: null,
  },
];

export const mockStorefrontMerchant = mockMerchant as unknown as Awaited<
  ReturnType<typeof import('@/lib/cached-data').getRequestScopedMerchant>
>;
