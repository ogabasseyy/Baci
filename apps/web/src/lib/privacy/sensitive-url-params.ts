/**
 * Query-string parameters that carry order-access tokens or shopper details.
 * Browser ad/analytics scripts read the page address, so these names must
 * never stay in the address bar (see private-url-param-stash.ts).
 */
export const SENSITIVE_URL_PARAM_NAMES = [
  'token',
  'trackingToken',
  'tracking_token',
  'email',
  'customerEmail',
  'phone',
  'customerPhone',
  'name',
  'customerName',
] as const;

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
