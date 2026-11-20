import { describe, expect, it } from 'vitest';
import { type Biller, NetworkProvider } from './kuda';
import { providerMatchesNetwork } from './kuda-provider-matches-network';

const provider = (billerName: string) => ({ billerName }) as Biller;

describe('providerMatchesNetwork', () => {
  it('matches a provider named after the network', () => {
    expect(
      providerMatchesNetwork(provider('MTN NG DATA'), NetworkProvider.MTN)
    ).toBe(true);
  });

  it('does not match another network', () => {
    expect(
      providerMatchesNetwork(provider('AIRTEL NG DATA'), NetworkProvider.MTN)
    ).toBe(false);
  });

  it('matches 9mobile under its other names', () => {
    expect(
      providerMatchesNetwork(
        provider('T2MOBILE NG DATA'),
        NetworkProvider.MOBILE_9
      )
    ).toBe(true);
  });

  it('does not treat any provider with a 9 in its name as 9mobile', () => {
    expect(
      providerMatchesNetwork(
        provider('SWIFT 9JA DATA'),
        NetworkProvider.MOBILE_9
      )
    ).toBe(false);
  });
});
