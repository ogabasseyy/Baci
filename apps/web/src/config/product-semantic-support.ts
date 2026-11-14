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
  tablets: {
    alternativesHeading: 'Alternative tablets to compare',
    sameBrandHeading: 'More tablets from this brand',
    samePriceHeading: 'More tablets in this price range',
  },
  'childrens-tablets': {
    alternativesHeading: 'Alternative kids tablets to compare',
    sameBrandHeading: 'More kids tablets from this brand',
    samePriceHeading: 'More kids tablets in this price range',
  },
  'gaming-laptops': {
    alternativesHeading: 'Alternative gaming laptops to compare',
    sameBrandHeading: 'More gaming laptops from this brand',
    samePriceHeading: 'More gaming laptops in this price range',
  },
  gaming: {
    alternativesHeading: 'Alternative gaming consoles and gear to compare',
    sameBrandHeading: 'More gaming gear from this brand',
    samePriceHeading: 'More gaming gear in this price range',
  },
  'playstation-5': {
    alternativesHeading: 'Alternative PS5 consoles and games to compare',
    sameBrandHeading: 'More PlayStation 5 options from this brand',
    samePriceHeading: 'More PlayStation 5 options in this price range',
  },
  'playstation-4': {
    alternativesHeading: 'Alternative PS4 consoles and games to compare',
    sameBrandHeading: 'More PlayStation 4 options from this brand',
    samePriceHeading: 'More PlayStation 4 options in this price range',
  },
  xbox: {
    alternativesHeading: 'Alternative Xbox consoles and games to compare',
    sameBrandHeading: 'More Xbox options from this brand',
    samePriceHeading: 'More Xbox options in this price range',
  },
  'nintendo-switch': {
    alternativesHeading: 'Alternative Nintendo Switch options to compare',
    sameBrandHeading: 'More Nintendo Switch options from this brand',
    samePriceHeading: 'More Nintendo Switch options in this price range',
  },
  'nintendo-switch-2': {
    alternativesHeading: 'Alternative Nintendo Switch 2 options to compare',
    sameBrandHeading: 'More Nintendo Switch 2 options from this brand',
    samePriceHeading: 'More Nintendo Switch 2 options in this price range',
  },
  'portable-gaming': {
    alternativesHeading: 'Alternative handheld gaming devices to compare',
    sameBrandHeading: 'More handheld gaming devices from this brand',
    samePriceHeading: 'More handheld gaming devices in this price range',
  },
  'vr-headsets': {
    alternativesHeading: 'Alternative VR headsets to compare',
    sameBrandHeading: 'More VR headsets from this brand',
    samePriceHeading: 'More VR headsets in this price range',
  },
  smartwatches: {
    alternativesHeading: 'Alternative smartwatches to compare',
    sameBrandHeading: 'More smartwatches from this brand',
    samePriceHeading: 'More smartwatches in this price range',
  },
  wearables: {
    alternativesHeading: 'Alternative wearables to compare',
    sameBrandHeading: 'More wearables from this brand',
    samePriceHeading: 'More wearables in this price range',
  },
  audio: {
    alternativesHeading: 'Alternative audio gear to compare',
    sameBrandHeading: 'More audio gear from this brand',
    samePriceHeading: 'More audio gear in this price range',
  },
  earbuds: {
    alternativesHeading: 'Alternative earbuds to compare',
    sameBrandHeading: 'More earbuds from this brand',
    samePriceHeading: 'More earbuds in this price range',
  },
  monitors: {
    alternativesHeading: 'Alternative monitors to compare',
    sameBrandHeading: 'More monitors from this brand',
    samePriceHeading: 'More monitors in this price range',
  },
  desktops: {
    alternativesHeading: 'Alternative desktops to compare',
    sameBrandHeading: 'More desktops from this brand',
    samePriceHeading: 'More desktops in this price range',
  },
  printers: {
    alternativesHeading: 'Alternative printers to compare',
    sameBrandHeading: 'More printers from this brand',
    samePriceHeading: 'More printers in this price range',
  },
  'lg-tvs': {
    alternativesHeading: 'Alternative LG TVs to compare',
    sameBrandHeading: 'More LG TVs from this brand',
    samePriceHeading: 'More LG TVs in this price range',
  },
  'samsung-tvs': {
    alternativesHeading: 'Alternative Samsung TVs to compare',
    sameBrandHeading: 'More Samsung TVs from this brand',
    samePriceHeading: 'More Samsung TVs in this price range',
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
