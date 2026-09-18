/**
 * Pinned remote-destination gate for feed image verification.
 *
 * Resolves a validated image URL to its DNS addresses, classifies every
 * address through the remote URL policy, and returns an HTTP dispatcher
 * pinned to the first public address. Pinning closes the resolve/fetch
 * DNS-rebinding window: the transport below can no longer re-resolve the
 * merchant-controlled hostname to a different (private) address, while
 * TLS still negotiates against the original host.
 *
 * Node.js-only; runs on the VPS backfill host. Single export per the
 * repository modularity boundary.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, type Dispatcher } from 'undici';
import { validateRemoteUrl } from './remote-url-policy';

/** DNS resolution seam: hostname -> resolved addresses. */
export type DestinationLookupFn = (hostname: string) => Promise<
  Array<{ address: string; family: number }>
>;

export type PinnedDestination =
  | { address: string; family: 4 | 6; dispatcher: Dispatcher }
  | { failure: string; retryable: boolean };

const defaultLookup: DestinationLookupFn = (hostname) =>
  dnsLookup(hostname, { all: true });

/**
 * Validate `url`, resolve its hostname, and pin a dispatcher to the first
 * publicly routable address. The caller must close `dispatcher` after use.
 */
export async function resolvePinnedDestination(
  url: string,
  lookupFn: DestinationLookupFn = defaultLookup
): Promise<PinnedDestination> {
  const validUrl = validateRemoteUrl(url);
  if (!validUrl) {
    return {
      failure: `Rejected remote image destination: ${url}`,
      retryable: false,
    };
  }
  // URL.hostname retains IPv6 brackets, which DNS resolvers reject.
  const hostname = validUrl.hostname.replace(/^\[(.*)\]$/, '$1');
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupFn(hostname);
  } catch {
    // The address was never proven private; leave the caller retryable.
    return {
      failure: `DNS resolution failed for ${hostname}`,
      retryable: true,
    };
  }
  if (addresses.length === 0) {
    return {
      failure: `DNS resolution returned no addresses for ${hostname}`,
      retryable: true,
    };
  }
  const pinned = addresses.find(({ address, family }) => {
    const literal = family === 6 ? `http://[${address}]/` : `http://${address}/`;
    return validateRemoteUrl(literal) !== null;
  });
  if (!pinned) {
    const seen = addresses.map((entry) => entry.address).join(', ');
    return {
      failure: `Rejected remote image destination: ${hostname} resolves to non-public address ${seen}`,
      retryable: false,
    };
  }
  const family = pinned.family === 6 ? 6 : 4;
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, _opts, callback) =>
        callback(null, pinned.address, family),
    },
  });
  return { address: pinned.address, family, dispatcher };
}
