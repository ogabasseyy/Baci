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
  'name',
  'customerName',
  'customer_name',
  'customer-name',
  'payerName',
  'payer_name',
  'payer-name',
] as const;

/**
 * Query-string parameters the page itself needs in the address bar, but whose
 * values can embed a token (for example `?redirect=/receipts/claim/<token>`).
 * They are dropped only from URLs sent to analytics, never from the address
 * bar, and are not stashed.
 */
export const TRACKING_ONLY_DROPPED_PARAM_NAMES = [
  'redirect',
  'redirectTo',
  'redirect_to',
  'next',
  'returnTo',
  'return_to',
  'callbackUrl',
] as const;

const TRACKING_ONLY_DROPPED_LOWERCASE = new Set(
  TRACKING_ONLY_DROPPED_PARAM_NAMES.map((name) => name.toLowerCase())
);

/** True for params that must not appear in URLs sent to ad/analytics vendors. */
export function isDroppedFromTrackingUrl(name: string): boolean {
  return (
    isSensitiveUrlParam(name) ||
    TRACKING_ONLY_DROPPED_LOWERCASE.has(name.toLowerCase())
  );
}

const SENSITIVE_LOWERCASE = new Set(
  SENSITIVE_URL_PARAM_NAMES.map((name) => name.toLowerCase())
);

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

/** Query string with every param that must not reach ad/analytics vendors removed. */
export function trackingSafeSearch(search: string): string {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const kept = new URLSearchParams();
  for (const [name, value] of params) {
    if (!isDroppedFromTrackingUrl(name)) kept.append(name, value);
  }
  return kept.toString();
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
