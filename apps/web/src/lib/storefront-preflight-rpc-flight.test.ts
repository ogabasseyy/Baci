import { describe, expect, it } from 'vitest';
import {
  snapshotStorefrontPreflightRpcArgs,
  storefrontPreflightRpcFlightKey,
  storefrontPreflightRpcFlights,
} from './storefront-preflight-rpc-flight';

describe('storefront preflight RPC flights', () => {
  it('snapshots mutable request args before a deferred transport starts', () => {
    const args = { p_identifier: 'before.example', p_slug: 'before' };
    const snapshot = snapshotStorefrontPreflightRpcArgs(args);
    args.p_identifier = 'after.example';
    expect(snapshot).toEqual({
      p_identifier: 'before.example',
      p_slug: 'before',
    });
  });

  it('isolates flights by RPC implementation identity and reset permits a fresh read', async () => {
    const firstImpl = () => null;
    const secondImpl = () => null;
    expect(
      storefrontPreflightRpcFlightKey('key', 2000, 'production', firstImpl)
    ).not.toBe(
      storefrontPreflightRpcFlightKey('key', 2000, 'production', secondImpl)
    );
    let calls = 0;
    const firstValue = { data: 'first', attempt: null };
    const first = storefrontPreflightRpcFlights.run('same', async () => {
      calls += 1;
      return firstValue;
    });
    const second = storefrontPreflightRpcFlights.run('same', async () => {
      calls += 1;
      return { data: 'second', attempt: null };
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      firstValue,
      firstValue,
    ]);
    expect(calls).toBe(1);
    storefrontPreflightRpcFlights.reset();
    await expect(
      storefrontPreflightRpcFlights.run('same', async () => {
        calls += 1;
        return { data: 'fresh', attempt: null };
      })
    ).resolves.toEqual({ data: 'fresh', attempt: null });
    expect(calls).toBe(2);
  });
});
