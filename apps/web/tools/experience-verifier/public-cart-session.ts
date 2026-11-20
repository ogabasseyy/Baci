import { z } from 'zod';
import { cartSessionCookieName } from '@/lib/cart/principal';
import { createPublicCartPolicy } from './public-cart-policy';

type Request = { url: string; method: string; body?: string };
type Network = (
  request: Request & { headers: Record<string, string> }
) => Promise<{
  status: number;
  body: Buffer;
  cookies: string[];
}>;

/** Session state stays in the trusted process. The injected transport must pin
 * public DNS, reject redirects and bound response streams before buffering. */
export function createPublicCartSession(settings: {
  origin: string;
  merchantId: string;
  merchantSlug: string;
  productId: string;
  variantId?: string;
  launch?: { buildDigest: string; paths: string[] };
  network: Network;
  maxRequests?: number;
}) {
  const merchantId = z.uuid().parse(settings.merchantId);
  const authorize = createPublicCartPolicy(settings);
  const cookieName = cartSessionCookieName(merchantId);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(64)
    .parse(settings.maxRequests ?? 32);
  const cookies = new Map<string, string>();
  let requests = 0;
  let inFlight = false;
  let failed = false;

  return async (input: Request) => {
    if (failed || inFlight || !authorize(input) || requests >= limit)
      throw Error('PUBLIC_CART_REQUEST_DENIED');
    const csrf = cookies.get('__Host-csrf-token') ?? cookies.get('csrf-token');
    if (input.method === 'POST' && !csrf)
      throw Error('PUBLIC_CART_CSRF_MISSING');
    requests++;
    inFlight = true;
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (
        input.method === 'GET' &&
        new URL(input.url).pathname === '/api/storefront/cart'
      )
        headers['x-baci-cart-probe'] = '1';
      if (cookies.size)
        headers.cookie = [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
      if (input.method === 'POST') {
        headers['content-type'] = 'application/json';
        headers.origin = settings.origin;
        headers['x-csrf-token'] = csrf as string;
      }
      const response = await settings.network({ ...input, headers });
      if (
        !Number.isInteger(response.status) ||
        response.status < 200 ||
        response.status >= 300 ||
        !Buffer.isBuffer(response.body) ||
        response.body.length > 1048576 ||
        response.cookies.length > 16
      )
        throw Error('PUBLIC_CART_UPSTREAM_FAILED');
      const next = new Map(cookies);
      const seen = new Set<string>();
      for (const raw of response.cookies) {
        if (raw.length > 8192) throw Error('PUBLIC_CART_COOKIE_INVALID');
        const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
        const equal = pair.indexOf('=');
        if (equal <= 0) continue;
        const name = pair.slice(0, equal);
        if (![cookieName, '__Host-csrf-token', 'csrf-token'].includes(name))
          continue;
        const value = pair.slice(equal + 1);
        const flags = attributes.map((part) => part.toLowerCase());
        const expiry = flags.filter((part) => part.startsWith('expires='));
        const age = flags.filter((part) => part.startsWith('max-age='));
        if (
          seen.has(name) ||
          !/^[A-Za-z0-9._~-]{1,4096}$/.test(value) ||
          !flags.includes('secure') ||
          !flags.includes('path=/') ||
          flags.some((part) => part.startsWith('domain=')) ||
          expiry.length > 1 ||
          (expiry.length === 1 &&
            (!Number.isFinite(Date.parse(expiry[0].slice(8))) ||
              Date.parse(expiry[0].slice(8)) <= Date.now())) ||
          age.length > 1 ||
          (age.length === 1 && !/^max-age=[1-9][0-9]*$/.test(age[0])) ||
          (name === cookieName && !flags.includes('httponly'))
        )
          throw Error('PUBLIC_CART_COOKIE_INVALID');
        seen.add(name);
        next.set(name, value);
      }
      const parsed: unknown = response.body.length
        ? JSON.parse(response.body.toString('utf8'))
        : null;
      if (containsProof(parsed)) throw Error('PUBLIC_CART_PROOF_IN_BODY');
      cookies.clear();
      for (const [name, value] of next) cookies.set(name, value);
      return { status: response.status, body: response.body.toString('utf8') };
    } catch (error) {
      failed = true;
      cookies.clear();
      throw error;
    } finally {
      inFlight = false;
    }
  };
}

function containsProof(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsProof);
  return Object.entries(value).some(
    ([key, child]) => /proof/i.test(key) || containsProof(child)
  );
}
