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

  it.each([
    '9 MOBILE DATA',
    '9MOBILE NG DATA',
    'MOBILE 9 DATA',
    'ETISALAT DATA',
  ])('matches the 9mobile name %j', (name) => {
    expect(
      providerMatchesNetwork(provider(name), NetworkProvider.MOBILE_9)
    ).toBe(true);
  });

  it('does not match "t2" inside another word', () => {
    expect(
      providerMatchesNetwork(
        provider('SMART2GO DATA'),
        NetworkProvider.MOBILE_9
      )
    ).toBe(false);
  });

  it.each([
    ['MTN SME DATA', NetworkProvider.MTN, true],
    ['GLO NG DATA', NetworkProvider.GLO, true],
    ['AIRTEL NG DATA', NetworkProvider.AIRTEL, true],
    ['GLOBACOM PLUS DATA', NetworkProvider.GLO, false],
    ['SMTNET DATA', NetworkProvider.MTN, false],
  ])('matches %j to %s only as a whole word (%s)', (name, network, expected) => {
    expect(providerMatchesNetwork(provider(name), network)).toBe(expected);
  });
});
