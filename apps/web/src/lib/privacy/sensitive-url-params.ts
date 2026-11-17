/**
 * Query-string parameters that carry order-access tokens or shopper details.
 * Browser ad/analytics scripts read the page address, so these names must
 * never stay in the address bar (see private-url-param-stash.ts).
 *
 * Deliberately NOT listed: payment-provider references (`reference`,
 * `credpalRef`, Klump `transaction_id` / `tx_ref` / `id`) and `orderId`. They
 * are provider or order identifiers that the callback flows match on, not
 * credentials or personal data, and removing them would break those flows.
 */
export const SENSITIVE_URL_PARAM_NAMES = [
  'token',
  'trackingToken',
  'tracking_token',
  'tracking-token',
  'email',
  'customerEmail',
  'customer_email',
  'customer-email',
  'phone',
  'customerPhone',
  'customer_phone',
  'customer-phone',
  // Bare `name` and `next` are broad on purpose: the hooked pages receive shopper
  // names and post-login redirect targets under exactly these keys. A stripped
  // value is restored from the per-tab stash on reload but is not kept when the
  // link is shared or opened in another tab, which is intended for personal data.
  'name',
  'customerName',
  'customer_name',
  'customer-name',
  'payerName',
  'payer_name',
  'payer-name',
  // Redirect targets can embed a token (`?redirect=/receipts/claim/<token>`).
  // Every read of them on the pages that use usePrivateSearchParams goes
  // through that hook, so the value is moved out of the address bar too.
  'redirect',
  'redirectTo',
  'redirect_to',
  'next',
  'returnTo',
  'return_to',
  'callbackUrl',
] as const;

const SENSITIVE_LOWERCASE = new Set(
  SENSITIVE_URL_PARAM_NAMES.map((name) => name.toLowerCase())
);

/**
 * Path prefixes whose NEXT segment is a capability token (anyone holding the
 * link can act on it). Shopper-facing routes only: today that is the receipt
 * claim link `/receipts/claim/<token>`. The segment is replaced with
 * `PATH_TOKEN_PLACEHOLDER` in every URL sent to a vendor; it works for bare
 * paths and absolute URLs, with or without a storefront prefix.
 */
export const SENSITIVE_PATH_PREFIXES = ['/receipts/claim/'] as const;

export const PATH_TOKEN_PLACEHOLDER = '[redacted]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Source of the regex that matches a prefix and the token segment after it. */
export const SENSITIVE_PATH_REGEX_SOURCE = `(${SENSITIVE_PATH_PREFIXES.map(
  escapeRegExp
).join('|')})[^/?#]+`;

/** Replaces the token segment of any sensitive path prefix in `url`. */
export function redactPathTokens(url: string): string {
  return url.replace(
    new RegExp(SENSITIVE_PATH_REGEX_SOURCE, 'gi'),
    `$1${PATH_TOKEN_PLACEHOLDER}`
  );
}

export type PrivateEntry = [name: string, value: string];

export function isSensitiveUrlParam(name: string): boolean {
  return SENSITIVE_LOWERCASE.has(name.toLowerCase());
}

/**
 * Splits a query string into the sensitive entries and the remaining query.
 * `publicSearch` has no leading `?` and keeps the order of the other params.
 */
export function partitionSensitiveSearch(search: string): {
  privateEntries: PrivateEntry[];
  publicSearch: string;
} {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const privateEntries: PrivateEntry[] = [];
  const publicParams = new URLSearchParams();
  for (const [name, value] of params) {
    if (isSensitiveUrlParam(name)) {
      privateEntries.push([name, value]);
    } else {
      publicParams.append(name, value);
    }
  }
  return { privateEntries, publicSearch: publicParams.toString() };
}

/** Order-independent form of a query string, for equality checks. */
export function canonicalSearch(search: string | URLSearchParams): string {
  const params = new URLSearchParams(
    typeof search === 'string'
      ? search.startsWith('?')
        ? search.slice(1)
        : search
      : search
  );
  params.sort();
  return params.toString();
}
