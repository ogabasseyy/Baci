import { Agent } from 'undici';
import { createPublicCartPolicy } from './public-cart-policy';
import {
  type PublicDnsLookup,
  publicNetworkSignal,
  readPublicBody,
  resolvePublicAddress,
} from './public-network-lifetime';

type Address = { address: string; family: number };
type Request = {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
};
type Dial = (
  request: Request,
  address: Address,
  signal: AbortSignal
) => Promise<{ response: Response; close(): Promise<void> }>;

const dialPinned: Dial = async (request, address, signal) => {
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
      signal,
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    return {
      response,
      close: () => (signal.aborted ? dispatcher.destroy() : dispatcher.close()),
    };
  } catch (error) {
    await dispatcher.destroy();
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
  signal?: AbortSignal;
  resolve?: PublicDnsLookup;
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
      const address = await resolvePublicAddress(
        url.hostname,
        settings.signal,
        settings.resolve
      );
      const signal = publicNetworkSignal(10000, settings.signal);
      signal.throwIfAborted();
      resource = await (settings.dial ?? dialPinned)(request, address, signal);
      if (signal.aborted)
        await resource.response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
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
      let size = 0;
      const bytes = await readPublicBody(
        resource.response.body,
        signal,
        (bytes) => {
          size += bytes;
          if (size > 1048576) throw Error();
        }
      );
      return {
        status: resource.response.status,
        body: bytes,
        cookies,
      };
    } catch {
      throw Error('PUBLIC_CART_NETWORK_FAILED');
    } finally {
      await resource?.close();
    }
  };
}
