import type { BuildCommercialGuideLinksContext } from './content-cluster-types';
import { isProductVariantColorToken } from './is-product-variant-color-token';

const GAME_CATEGORY_PATTERN =
  /^(?:(?:portable-)?gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;
const GAME_HARDWARE_MARKERS = new Set([
  'adapter',
  'cable',
  'charger',
  'console',
  'controller',
  'dock',
  'headset',
  'keyboard',
  'remote',
  'speaker',
  'stand',
]);
const CONSOLE_PLATFORM_TOKENS = new Set([
  'microsoft',
  'nintendo',
  'playstation',
  'ps4',
  'ps5',
  'sony',
  'switch',
  'xbox',
]);
const CONSOLE_VARIANT_TOKENS = new Set([
  '2',
  '4',
  '5',
  'all',
  'digital',
  'disc',
  'edition',
  'lite',
  'model',
  'oled',
  'pro',
  'series',
  'slim',
  'standard',
  's',
  'x',
]);

function isConsolePlatformProduct(tokens: string[]) {
  return (
    tokens.some((token) => CONSOLE_PLATFORM_TOKENS.has(token)) &&
    tokens.every(
      (token) =>
        CONSOLE_PLATFORM_TOKENS.has(token) ||
        CONSOLE_VARIANT_TOKENS.has(token) ||
        isProductVariantColorToken(token) ||
        /^\d+(?:gb|tb)$/u.test(token)
    )
  );
}

/** Decides whether catalog wording should preserve game-title tokens. */
export function isGameProduct(
  context: Omit<BuildCommercialGuideLinksContext, 'pageKind'>,
  tokenize: (value: string) => string[]
) {
  if (!GAME_CATEGORY_PATTERN.test(context.categorySlug)) {
    return false;
  }
  const sourceTokens = (context.productNames ?? context.productSlugs ?? []).map(
    tokenize
  );
  return !sourceTokens.some(
    (tokens) =>
      tokens.some((token) => GAME_HARDWARE_MARKERS.has(token)) ||
      isConsolePlatformProduct(tokens)
  );
}
