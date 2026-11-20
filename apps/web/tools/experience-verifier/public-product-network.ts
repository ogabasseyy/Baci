import { Agent } from 'undici';
import {
  type PublicDnsLookup,
  publicNetworkSignal,
  readPublicBody,
  resolvePublicAddress,
} from './public-network-lifetime';
import { createPublicProductPolicy } from './public-product-policy';

type Address = { address: string; family: number };
type Dial = (
  url: URL,
  address: Address,
  key: string,
  signal: AbortSignal
) => Promise<{ response: Response; close(): Promise<void> }>;
const pinned: Dial = async (url, address, key, signal) => {
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

/** Anonymous RLS only. Never accepts browser headers, cookies or bearer tokens. */
export function createPublicProductNetwork(settings: {
  origin: string;
  merchantId: string;
  productId: string;
  publishableKey: string;
  signal?: AbortSignal;
  resolve?: PublicDnsLookup;
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
      const address = await resolvePublicAddress(
        url.hostname,
        settings.signal,
        settings.resolve
      );
      const signal = publicNetworkSignal(10000, settings.signal);
      signal.throwIfAborted();
      resource = await (settings.dial ?? pinned)(
        url,
        address,
        settings.publishableKey,
        signal
      );
      if (signal.aborted)
        await resource.response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
      if (resource.response.status !== 200) {
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
      const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
