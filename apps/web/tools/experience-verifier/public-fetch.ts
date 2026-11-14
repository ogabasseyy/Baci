import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { productionOrigin } from '@/lib/experience/production-origins';
import { isPublicPublicationAddress } from '../builder-auth/publication-fetch';

type Address = { address: string; family: number };
type Network = (
  url: URL,
  address: Address
) => Promise<{ response: Response; close(): Promise<void> }>;
const securityHeaderNames = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'origin-agent-cluster',
  'access-control-allow-origin',
  'access-control-allow-credentials',
] as const;
const defaultNetwork: Network = async (url, address) => {
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
      redirect: 'manual',
      credentials: 'omit',
      headers: { accept: '*/*' },
      signal: AbortSignal.timeout(10000),
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    return { response, close: () => dispatcher.close() };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
};

/** Trusted verifier input only; GETs are pinned to public DNS and bound origins. */
export function createBoundPublicFetcher(settings: {
  origins: string[];
  urls: string[];
  resolve?: (hostname: string) => Promise<Address[]>;
  network?: Network;
}) {
  if (settings.origins.length < 1 || settings.origins.length > 2)
    throw Error('INVALID_PUBLIC_ORIGINS');
  const origins = new Set(settings.origins.map(productionOrigin));
  if (settings.urls.length < 1 || settings.urls.length > 256)
    throw Error('INVALID_PUBLIC_URLS');
  const urls = new Set(
    settings.urls.map((value) => {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !origins.has(url.origin) ||
        url.href !== value
      )
        throw Error('INVALID_PUBLIC_URLS');
      return url.href;
    })
  );
  let requests = 0;
  let total = 0;
  return async (value: string) => {
    let resource: Awaited<ReturnType<Network>> | undefined;
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !origins.has(url.origin) ||
        !urls.has(url.href) ||
        ++requests > 256
      )
        throw Error();
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
          (a) =>
            isIP(a.address) !== a.family ||
            !isPublicPublicationAddress(a.address)
        )
      )
        throw Error();
      resource = await (settings.network ?? defaultNetwork)(
        url,
        addresses.find((a) => a.family === 4) ?? addresses[0]
      );
      if (resource.response.status !== 200) {
        await resource.response.body?.cancel().catch(() => undefined);
        throw Error();
      }
      const contentType = resource.response.headers.get('content-type') ?? '';
      const securityHeaders: Record<string, string> = {};
      let headerBytes = 0;
      if (Buffer.byteLength(contentType) > 1024) {
        await resource.response.body?.cancel().catch(() => undefined);
        throw Error();
      }
      for (const name of securityHeaderNames) {
        const value = resource.response.headers.get(name);
        if (value === null) continue;
        const size = Buffer.byteLength(value);
        headerBytes += size;
        if (size > 8192 || headerBytes > 32768) {
          await resource.response.body?.cancel().catch(() => undefined);
          throw Error();
        }
        securityHeaders[name] = value;
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
            total += part.value.byteLength;
            if (size > 2097152 || total > 16777216) throw Error();
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      return {
        body: Buffer.concat(chunks),
        contentType,
        securityHeaders,
      };
    } catch {
      throw Error('PUBLIC_FETCH_FAILED');
    } finally {
      await resource?.close();
    }
  };
}
