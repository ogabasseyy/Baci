const PRODUCT_SEMANTIC_SUPPORT = {
  default: {
    alternativesHeading: 'Similar options to consider',
    sameBrandHeading: 'More from this brand',
    samePriceHeading: 'More in this price range',
    trustBulletPrefix: 'Buying context',
  },
  smartphones: {
    alternativesHeading: 'Alternative phones to compare',
    sameBrandHeading: 'More phones from this brand',
    samePriceHeading: 'More phones in this price range',
  },
  laptops: {
    alternativesHeading: 'Alternative laptops to compare',
    sameBrandHeading: 'More laptops from this brand',
    samePriceHeading: 'More laptops in this price range',
  },
  'smart-tvs': {
    alternativesHeading: 'Alternative TVs to compare',
    sameBrandHeading: 'More TVs from this brand',
    samePriceHeading: 'More TVs in this price range',
  },
} as const;

export function getProductSemanticSupport(categorySlug: string) {
  const categorySupport =
    PRODUCT_SEMANTIC_SUPPORT[
      categorySlug as Exclude<keyof typeof PRODUCT_SEMANTIC_SUPPORT, 'default'>
    ];

  return {
    ...PRODUCT_SEMANTIC_SUPPORT.default,
    ...(categorySupport ?? {}),
  };
}
