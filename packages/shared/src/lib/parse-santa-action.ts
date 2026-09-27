/**
 * Santa AI chat directive parsing.
 *
 * Santa replies can embed one or more machine-readable directives instructing
 * the storefront to add a (possibly negotiated) product to the cart:
 *
 *   ACTION:ADD_TO_CART|PRODUCT:<name>|PRICE:<amount>
 *
 * PRICE may contain thousands separators, optional decimals, and optional
 * whitespace/currency suffixes (e.g. 1,200,000 NGN). Shared between the web
 * and mobile storefronts so both parse the directive identically.
 */

export interface SantaAction {
  type: 'ADD_TO_CART';
  productName: string;
  price: number;
}

const SANTA_ACTION_CURRENCY_CODES = [
  'NGN',
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
  'JPY',
  'INR',
  'BRL',
  'ZAR',
  'AED',
  'KES',
  'GHS',
  'EGP',
  'XAF',
  'XOF',
  'RWF',
  'TZS',
  'UGX',
] as const;

const SANTA_ACTION_CURRENCY_PATTERN = SANTA_ACTION_CURRENCY_CODES.join('|');

const SANTA_ACTION_PATTERN_SOURCE = String.raw`ACTION:ADD_TO_CART\|PRODUCT:((?:(?!ACTION:ADD_TO_CART).)+?)\|PRICE:\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(?:${SANTA_ACTION_CURRENCY_PATTERN}))?[.,!?;:]*(?![\d,])`;

const SANTA_ACTION_PATTERN = new RegExp(SANTA_ACTION_PATTERN_SOURCE, 'i');
const SANTA_ACTION_GLOBAL_PATTERN = new RegExp(
  SANTA_ACTION_PATTERN_SOURCE,
  'gi'
);

function toSantaAction(match: RegExpMatchArray): SantaAction | null {
  const productName = match[1]?.trim();
  const priceText = match[2];

  if (!productName || !priceText) {
    return null;
  }

  return {
    type: 'ADD_TO_CART',
    productName,
    price: Number.parseFloat(priceText.replace(/,/g, '')),
  };
}

/**
 * Parse every `ACTION:ADD_TO_CART|PRODUCT:xxx|PRICE:xxx` directive from
 * Santa's response. Returns an empty array if no well-formed directives are
 * present.
 */
export function parseSantaActions(content: string): SantaAction[] {
  return Array.from(content.matchAll(SANTA_ACTION_GLOBAL_PATTERN))
    .map(toSantaAction)
    .filter((action): action is SantaAction => action !== null);
}

/**
 * Parse the first `ACTION:ADD_TO_CART|PRODUCT:xxx|PRICE:xxx` directive from
 * Santa's response. Kept for existing single-action consumers.
 */
export function parseSantaAction(content: string): SantaAction | null {
  const match = content.match(SANTA_ACTION_PATTERN);
  return match ? toSantaAction(match) : null;
}

/**
 * Remove every Santa action directive from a response so the user-facing text
 * never shows the raw `ACTION:...` machinery.
 */
export function stripSantaActions(content: string): string {
  return content
    .replace(SANTA_ACTION_GLOBAL_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}
