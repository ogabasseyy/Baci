/**
 * PiggyVest egress relay: the only requests the relay will ever forward.
 *
 * Derived from the PiggyVest call sites in apps/web/src/lib/piggyvest
 * (production origin). Sandbox-only `/transfer/test/funding` is excluded on
 * purpose. The request target is validated byte-wise before any matching, so
 * no host, scheme, traversal, encoded separator or control character can
 * reach the upstream.
 */

const ID = '[A-Za-z0-9._~%-]{1,128}';
const TARGET_CHARACTERS = /^[A-Za-z0-9\-._~%/?=&+,:*]+$/;
const MAX_TARGET_LENGTH = 1024;

const NONE = [];
const route = (method, path, query = NONE) => ({
  method,
  template: path,
  pattern: new RegExp(`^${path.replace(/:id/g, ID)}$`),
  query: new Set(query),
});

export const ROUTES = [
  route('GET', '/api/v1/customers', ['third_party_identifier']),
  route('POST', '/api/v1/customers', ['returnIfExist']),
  route('GET', '/api/v1/wallet/api/wallet-type', [
    'customer_id',
    'limit',
    'orderBy',
    'cursor',
  ]),
  route('POST', '/api/v1/wallet/sub-account'),
  route('POST', '/api/v1/wallet/reserve-account'),
  route('GET', '/api/v1/wallet/:id/accounts'),
  route('GET', '/api/v1/wallet/interests/accrued/:id', [
    'start_date',
    'end_date',
    'limit',
    'interest_type',
    'cursor',
  ]),
  route('GET', '/api/v1/wallet/:id'),
  route('POST', '/api/v1/transfer/wallet'),
  route('POST', '/api/v1/transfer/bank'),
  route('GET', '/api/v1/transfer/name-enquiry', [
    'bank_code',
    'account_number',
  ]),
  route('GET', '/api/v1/transfer/bank-list'),
  route('POST', '/api/v1/transfer/schedule-payment'),
  route('PATCH', '/api/v1/transfer/schedule-payment/:id'),
  route('GET', '/api/v1/transaction/verify', ['reference', 'wallet_id']),
  route('GET', '/api/v1/transaction', [
    'wallet_id',
    'limit',
    'collapse_batch',
    'cursor',
  ]),
  route('GET', '/api/v1/transaction/:id', ['wallet_id']),
];

function hasUnsafeEncoding(target) {
  // Malformed escapes, encoded dot/slash/backslash/NUL, double-encoding.
  if (/%(?![0-9A-Fa-f]{2})/.test(target)) return true;
  return /%(2e|2f|5c|00|25)/i.test(target);
}

/**
 * @returns {{template: string, pathname: string, search: string} | null}
 * null means "not allowlisted": the caller answers 404 without contacting
 * the upstream.
 */
export function matchAllowlistedTarget(method, target) {
  if (typeof method !== 'string' || typeof target !== 'string') return null;
  if (target.length === 0 || target.length > MAX_TARGET_LENGTH) return null;
  if (target[0] !== '/' || target.startsWith('//')) return null;
  if (!TARGET_CHARACTERS.test(target)) return null; // CRLF, spaces, #, \, non-ASCII
  if (target.includes('..') || hasUnsafeEncoding(target)) return null;

  const queryStart = target.indexOf('?');
  const pathname = queryStart === -1 ? target : target.slice(0, queryStart);
  const search = queryStart === -1 ? '' : target.slice(queryStart + 1);
  if (pathname.split('/').some((segment) => segment === '.')) return null;

  const matched = ROUTES.find(
    (candidate) =>
      candidate.method === method && candidate.pattern.test(pathname)
  );
  if (!matched) return null;

  if (queryStart !== -1) {
    if (search === '' || matched.query.size === 0) return null;
    const seen = new Set();
    for (const pair of search.split('&')) {
      const key = pair.split('=')[0];
      if (!matched.query.has(key) || seen.has(key)) return null;
      seen.add(key);
    }
  }
  return { template: matched.template, pathname, search };
}
