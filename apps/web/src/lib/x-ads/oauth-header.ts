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
  oauth.oauth_signature = createHmac(
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
