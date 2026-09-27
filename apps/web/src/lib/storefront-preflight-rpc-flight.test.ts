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
    const first = storefrontPreflightRpcFlights.run('same', async () => {
      calls += 1;
      return 'first';
    });
    const second = storefrontPreflightRpcFlights.run('same', async () => {
      calls += 1;
      return 'second';
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'first',
    ]);
    expect(calls).toBe(1);
    storefrontPreflightRpcFlights.reset();
    await expect(
      storefrontPreflightRpcFlights.run('same', async () => {
        calls += 1;
        return 'fresh';
      })
    ).resolves.toBe('fresh');
    expect(calls).toBe(2);
  });
});
