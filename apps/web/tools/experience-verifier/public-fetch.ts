import { Agent } from 'undici';
import { productionOrigin } from '@/lib/experience/production-origins';
import { PUBLIC_VERIFICATION_FETCH_TIMEOUT_MS } from '@/lib/experience/public-verification-deadline';
import {
  MAX_PUBLIC_FETCH_BYTES,
  MAX_PUBLIC_RESOURCE_BYTES,
} from '../experience-runner/public-observation-resource-limit';
import {
  type PublicDnsLookup,
  publicNetworkSignal,
  readPublicBody,
  resolvePublicAddress,
} from './public-network-lifetime';

type Address = { address: string; family: number };
type Network = (
  url: URL,
  address: Address,
  signal: AbortSignal
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
const defaultNetwork: Network = async (url, address, signal) => {
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

/** Trusted verifier input only; GETs are pinned to public DNS and bound origins. */
export function createBoundPublicFetcher(settings: {
  origins: string[];
  urls: string[];
  signal?: AbortSignal;
  resolve?: PublicDnsLookup;
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
      const address = await resolvePublicAddress(
        url.hostname,
        settings.signal,
        settings.resolve
      );
      const signal = publicNetworkSignal(
        PUBLIC_VERIFICATION_FETCH_TIMEOUT_MS,
        settings.signal
      );
      signal.throwIfAborted();
      resource = await (settings.network ?? defaultNetwork)(
        url,
        address,
        signal
      );
      if (signal.aborted)
        await resource.response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
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
      let size = 0;
      const bytes = await readPublicBody(
        resource.response.body,
        signal,
        (bytes) => {
          size += bytes;
          total += bytes;
          if (
            size > MAX_PUBLIC_RESOURCE_BYTES ||
            total > MAX_PUBLIC_FETCH_BYTES
          )
            throw Error();
        }
      );
      return {
        body: bytes,
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
