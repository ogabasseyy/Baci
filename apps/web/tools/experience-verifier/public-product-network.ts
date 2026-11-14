import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { isPublicPublicationAddress } from '../builder-auth/publication-fetch';
import { createPublicProductPolicy } from './public-product-policy';

type Address = { address: string; family: number };
type Dial = (
  url: URL,
  address: Address,
  key: string
) => Promise<{ response: Response; close(): Promise<void> }>;
const pinned: Dial = async (url, address, key) => {
  const dispatcher = new Agent({
    connect: {
      autoSelectFamily: false,
      lookup: (_host, _options, callback) =>
        callback(null, address.address, address.family),
    },
  });
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(10000),
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    return { response, close: () => dispatcher.close() };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
};

/** Anonymous RLS only. Never accepts browser headers, cookies or bearer tokens. */
export function createPublicProductNetwork(settings: {
  origin: string;
  merchantId: string;
  productId: string;
  publishableKey: string;
  resolve?: (host: string) => Promise<Address[]>;
  dial?: Dial;
}) {
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(settings.publishableKey))
    throw Error('INVALID_PUBLIC_CLIENT');
  const allowed = createPublicProductPolicy(settings);
  let requests = 0;
  return async (request: { url: string; method: string }) => {
    let resource: Awaited<ReturnType<Dial>> | undefined;
    try {
      if (!allowed(request) || ++requests > 16) throw Error();
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
      resource = await (settings.dial ?? pinned)(
        url,
        addresses.find((address) => address.family === 4) ?? addresses[0],
        settings.publishableKey
      );
      if (resource.response.status !== 200) {
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
      const body = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks)
      );
      const value: unknown = JSON.parse(body);
      if (!Array.isArray(value) || value.length > 1) throw Error();
      if (
        value.length === 1 &&
        (!value[0] ||
          typeof value[0] !== 'object' ||
          value[0].id !== settings.productId ||
          value[0].merchant_id !== settings.merchantId ||
          value[0].status !== 'active')
      )
        throw Error();
      return { status: 200, body };
    } catch {
      throw Error('PUBLIC_PRODUCT_FETCH_FAILED');
    } finally {
      await resource?.close();
    }
  };
}
