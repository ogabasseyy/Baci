import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { isPublicPublicationAddress } from '../builder-auth/publication-fetch';
import { createPublicCartPolicy } from './public-cart-policy';

type Address = { address: string; family: number };
type Request = {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
};
type Dial = (
  request: Request,
  address: Address
) => Promise<{ response: Response; close(): Promise<void> }>;

const dialPinned: Dial = async (request, address) => {
  const dispatcher = new Agent({
    connect: {
      autoSelectFamily: false,
      lookup: (_host, _options, callback) =>
        callback(null, address.address, address.family),
    },
  });
  try {
    const response = await fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: request.headers,
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    return { response, close: () => dispatcher.close() };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
};

/** Trusted host transport, not an endpoint or a sandbox network permission. */
export function createPublicCartNetwork(settings: {
  origin: string;
  merchantSlug: string;
  productId: string;
  variantId?: string;
  launch?: { buildDigest: string; paths: string[] };
  resolve?: (host: string) => Promise<Address[]>;
  dial?: Dial;
}) {
  const authorize = createPublicCartPolicy(settings);
  return async (request: Request) => {
    let resource: Awaited<ReturnType<Dial>> | undefined;
    try {
      if (!authorize(request)) throw Error();
      const entries = Object.entries(request.headers);
      if (
        entries.some(
          ([key, value]) =>
            ![
              'accept',
              'content-type',
              'cookie',
              'origin',
              'x-csrf-token',
              'x-baci-cart-probe',
            ].includes(key) ||
            typeof value !== 'string' ||
            value.length > 8192 ||
            /[\r\n]/.test(value)
        )
      )
        throw Error();
      if (request.headers.accept !== 'application/json') throw Error();
      if (
        request.headers['x-baci-cart-probe'] !== undefined &&
        (request.method !== 'GET' ||
          new URL(request.url).pathname !== '/api/storefront/cart' ||
          request.headers['x-baci-cart-probe'] !== '1')
      )
        throw Error();
      if (
        request.method === 'GET' &&
        (request.headers.origin ||
          request.headers['x-csrf-token'] ||
          request.headers['content-type'])
      )
        throw Error();
      if (
        request.method === 'POST' &&
        (request.headers.origin !== settings.origin ||
          request.headers['content-type'] !== 'application/json' ||
          !request.headers.cookie ||
          !request.headers['x-csrf-token'])
      )
        throw Error();
      const url = new URL(request.url);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const addresses = await Promise.race([
        (settings.resolve ?? ((host) => lookup(host, { all: true })))(
          url.hostname
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error()), 5000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (
        !addresses.length ||
        addresses.some(
          (address) =>
            isIP(address.address) !== address.family ||
            !isPublicPublicationAddress(address.address)
        )
      )
        throw Error();
      resource = await (settings.dial ?? dialPinned)(
        request,
        addresses.find((address) => address.family === 4) ?? addresses[0]
      );
      if (resource.response.status < 200 || resource.response.status >= 300) {
        await resource.response.body?.cancel().catch(() => undefined);
        throw Error();
      }
      const cookies = resource.response.headers.getSetCookie();
      if (
        cookies.length > 16 ||
        cookies.some((cookie) => Buffer.byteLength(cookie) > 8192)
      ) {
        await resource.response.body?.cancel().catch(() => undefined);
        throw Error();
      }
      const reader = resource.response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 1048576) throw Error();
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      return {
        status: resource.response.status,
        body: Buffer.concat(chunks),
        cookies,
      };
    } catch {
      throw Error('PUBLIC_CART_NETWORK_FAILED');
    } finally {
      await resource?.close();
    }
  };
}
