import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';

export interface ValidatedDestinationAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Build the DNS override that pins the transport to validated addresses.
 * The `all:true` branch returns the full validated set so the transport
 * can fall back across records; single-address callers get the first.
 * The transport still cannot re-resolve DNS itself, so the rebinding
 * window stays closed.
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
