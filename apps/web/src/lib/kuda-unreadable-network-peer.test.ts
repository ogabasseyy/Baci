import { describe, expect, it } from 'vitest';
import { type Biller, NetworkProvider } from './kuda';
import { hasUnreadableNetworkPeer } from './kuda-unreadable-network-peer';

const biller = (billerName: string, packagesUnreadable?: true): Biller =>
  ({
    billerId: billerName,
    billerName,
    ...(packagesUnreadable && { packagesUnreadable }),
  }) as Biller;

describe('hasUnreadableNetworkPeer', () => {
  it('flags a malformed list on the plan’s own network when another network was sent', () => {
    const plan = biller('MTN SME DATA');
    const providers = [biller('MTN NG DATA', true), plan];

    expect(hasUnreadableNetworkPeer(providers, plan, NetworkProvider.GLO)).toBe(
      true
    );
  });

  it('flags a malformed list on the requested network', () => {
    const plan = biller('MTN SME DATA');
    const providers = [biller('GLO DATA', true), plan];

    expect(hasUnreadableNetworkPeer(providers, plan, NetworkProvider.GLO)).toBe(
      true
    );
  });

  it('flags the plan’s own provider when its list is malformed', () => {
    const plan = biller('Odd Provider', true);

    expect(hasUnreadableNetworkPeer([plan], plan, NetworkProvider.MTN)).toBe(
      true
    );
  });

  it('ignores a malformed list on an unrelated network', () => {
    const plan = biller('MTN SME DATA');
    const providers = [biller('AIRTEL DATA', true), plan];

    expect(hasUnreadableNetworkPeer(providers, plan, NetworkProvider.MTN)).toBe(
      false
    );
  });
});
