/**
 * Pinned remote-destination gate for feed image verification.
 *
 * Resolves a validated image URL to its DNS addresses, classifies every
 * address through the remote URL policy, and returns an HTTP dispatcher
 * pinned to the validated public addresses. Pinning closes the resolve/fetch
 * DNS-rebinding window: the transport below can no longer re-resolve the
 * merchant-controlled hostname to a different (private) address, while
 * TLS still negotiates against the original host.
 *
 * Node.js-only; runs on the VPS backfill host. Single export per the
 * repository modularity boundary.
 */

import type {
  LookupAddress,
  LookupAllOptions,
  LookupOneOptions,
} from 'node:dns';
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

export interface ValidatedDestinationAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Build the DNS override that pins the transport to validated addresses.
 * The `all:true` branch returns the full validated set so the transport
 * can fall back across records; single-address callers get the first.
 */
export function createPinnedLookup(addresses: ValidatedDestinationAddress[]) {
  const first = addresses[0];
  return (
    _hostname: string,
    options: LookupOneOptions | LookupAllOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number
    ) => void
  ): void => {
    if (options.all) {
      callback(null, [...addresses]);
    } else {
      callback(null, first.address, first.family);
    }
  };
}

/**
 * Validate `url`, resolve its hostname, and pin a dispatcher to the
 * publicly routable addresses. The caller must close `dispatcher` after use.
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
  // Retain every validated public address, not just the first: when the
  // first result is unreachable (commonly IPv6 on an IPv4-only backfill
  // host), the transport falls back to another validated record instead of
  // leaving the image pending_verification. The transport still cannot
  // re-resolve DNS itself, so the rebinding window stays closed.
  const validated = addresses
    .map(({ address, family }) => {
      const literal =
        family === 6 ? `http://[${address}]/` : `http://${address}/`;
      if (validateRemoteUrl(literal) === null) return null;
      return { address, family: family === 6 ? 6 : 4 } as const;
    })
    .filter((entry): entry is { address: string; family: 4 | 6 } => entry !== null);
  if (validated.length === 0) {
    const seen = addresses.map((entry) => entry.address).join(', ');
    return {
      failure: `Rejected remote image destination: ${hostname} resolves to non-public address ${seen}`,
      retryable: false,
    };
  }
  const pinned = validated[0];
  const family = pinned.family;
  // Matches node's dns.lookup overloads: net.connect requests all:true for
  // family autoselection, in which case the callback must receive the
  // address-record array form — the scalar form fails the connection with
  // ERR_INVALID_IP_ADDRESS.
  const lookup = createPinnedLookup(validated);
  const dispatcher = new Agent({ connect: { lookup } });
  return { address: pinned.address, family, dispatcher };
}
