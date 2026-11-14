export const BLACK_FRIDAY_PATH = '/black-friday';

// Add exact canonical catalog slugs in the order shoppers should see them.
// Keep lowercase, unpadded values: the storefront lineup query and RedVault
// deliberately use the same exact match, so only listed products qualify.
export const APPROVED_BLACK_FRIDAY_PRODUCT_SLUGS: readonly string[] = [];
const previewProductSlugs = [
  'iphone-18-pro-max',
  'samsung-galaxy-z-flip8',
  'xiaomi-17t-pro',
  'samsung-galaxy-s26-fe',
  'redmi-note-17-pro-max-5g',
  'samsung-galaxy-a27-5g',
  'xiaomi-17t',
  'samsung-galaxy-a08',
] as const;

export const IS_BLACK_FRIDAY_PREVIEW =
  process.env.NODE_ENV === 'development' &&
  APPROVED_BLACK_FRIDAY_PRODUCT_SLUGS.length === 0;

export const BLACK_FRIDAY_PRODUCT_SLUGS: readonly string[] =
  IS_BLACK_FRIDAY_PREVIEW
    ? previewProductSlugs
    : APPROVED_BLACK_FRIDAY_PRODUCT_SLUGS;
