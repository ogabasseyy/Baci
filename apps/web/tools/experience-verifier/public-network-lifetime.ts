import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PUBLIC_VERIFICATION_DNS_TIMEOUT_MS } from '@/lib/experience/public-verification-deadline';
import { isPublicPublicationAddress } from '../builder-auth/publication-fetch';

type Address = { address: string; family: number };
export type PublicDnsLookup = (
  host: string,
  signal: AbortSignal
) => Promise<Address[]>;

const resolvePublicDns: PublicDnsLookup = async (host, signal) => {
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const results = await Promise.allSettled([
      resolver.resolve4(host),
      resolver.resolve6(host),
    ]);
    signal.throwIfAborted();
    return results.flatMap((result, index) => {
      if (result.status === 'fulfilled')
        return result.value.map((address) => ({
          address,
          family: index === 0 ? 4 : 6,
        }));
      if (['ENODATA', 'ENOTFOUND'].includes(result.reason?.code)) return [];
      throw result.reason;
    });
  } finally {
    signal.removeEventListener('abort', cancel);
  }
};

export function publicNetworkSignal(ms: number, request?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return request ? AbortSignal.any([request, timeout]) : timeout;
}

export async function resolvePublicAddress(
  host: string,
  request?: AbortSignal,
  resolve: PublicDnsLookup = resolvePublicDns
) {
  const signal = publicNetworkSignal(
    PUBLIC_VERIFICATION_DNS_TIMEOUT_MS,
    request
  );
  signal.throwIfAborted();
  const addresses = await resolve(host, signal);
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(
      (address) =>
        isIP(address.address) !== address.family ||
        !isPublicPublicationAddress(address.address)
    )
  )
    throw Error('PUBLIC_DNS_DENIED');
  return addresses.find((address) => address.family === 4) ?? addresses[0];
}

export async function readPublicBody(
  body: Response['body'],
  signal: AbortSignal,
  acceptBytes: (size: number) => void
) {
  const reader = body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) return Buffer.concat(chunks);
      acceptBytes(part.value.byteLength);
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    await cancellation;
    reader.releaseLock();
  }
}
