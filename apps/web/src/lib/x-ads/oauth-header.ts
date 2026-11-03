import { createHmac, randomBytes } from 'node:crypto';
import type { XAdsCredentials } from '@/schemas/x-ads-settings';

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
/** OAuth 1.0a for JSON requests; only OAuth/query parameters enter the signature. */
export function createXOAuthHeader(
  url: string,
  method: string,
  credentials: XAdsCredentials,
  nonce = randomBytes(24).toString('hex'),
  timestamp = String(Math.floor(Date.now() / 1000))
): string {
  const target = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };
  const pairs = [...target.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a, av], [b, bv]) =>
      a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1
    );
  const normalized = pairs.map((pair) => pair.join('=')).join('&');
  const base = [
    method.toUpperCase(),
    encode(`${target.origin}${target.pathname}`),
    encode(normalized),
  ].join('&');
  // X Ads requires OAuth 1.0a HMAC-SHA1 over HTTPS; SHA-256 is not accepted.
  // This is a keyed protocol authenticator, not an unkeyed collision-sensitive hash.
  // https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests#custom-implementation
  oauth.oauth_signature = createHmac(
    // nosemgrep: javascript.node-stdlib.cryptography.crypto-weak-algorithm.crypto-weak-algorithm
    'sha1',
    `${encode(credentials.consumerSecret)}&${encode(credentials.accessTokenSecret)}`
  )
    .update(base)
    .digest('base64');
  return `OAuth ${Object.entries(oauth)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(', ')}`;
}
