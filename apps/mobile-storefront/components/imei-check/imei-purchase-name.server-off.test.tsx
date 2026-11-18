import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));

import { imeiPurchaseName } from './imei-purchase-name';

const IMEI = '490154203237518';

// The store credit rail is live with PiggyVest off on the server: its saved
// key name must not depend on PiggyVest at all.
describe('imeiPurchaseName with PiggyVest off on the server', () => {
  it('names a store credit check per account, store, device and tier', async () => {
    const name = await imeiPurchaseName(
      'imei-credit',
      'user-1',
      'smartphone',
      'blacklist',
      IMEI
    );

    expect(name).toMatch(
      /^imei-credit\|user-1\|merchant-1\|smartphone\|blacklist\|[0-9a-f]{64}$/
    );
    expect(name).not.toContain(IMEI);
  });

  it('gives one check one name however the IMEI was typed', async () => {
    await expect(
      imeiPurchaseName('imei-credit', 'user-1', 'smartphone', 'basic', IMEI)
    ).resolves.toBe(
      await imeiPurchaseName(
        'imei-credit',
        'user-1',
        'smartphone',
        'basic',
        ` ${IMEI.slice(0, 7)}-${IMEI.slice(7)} `
      )
    );
  });

  it('never shares a name between the PiggyVest and store credit rails', async () => {
    const credit = await imeiPurchaseName(
      'imei-credit',
      'user-1',
      'smartphone',
      'basic',
      IMEI
    );
    const piggyvest = await imeiPurchaseName(
      'imei',
      'user-1',
      'smartphone',
      'basic',
      IMEI
    );

    expect(piggyvest.startsWith('imei|')).toBe(true);
    expect(credit).not.toBe(piggyvest);
  });
});
