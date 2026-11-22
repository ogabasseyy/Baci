import { describe, expect, it } from 'vitest';
import { isDecemberInLagos, isSantaModeActive } from './santa-mode';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const DEC = new Date('2026-12-10T12:00:00Z');
const env = (values: Record<string, string | undefined>) =>
  values as unknown as NodeJS.ProcessEnv;
const on = env({ EKAETTE_CHATWOOT_SANTA_ENABLED: 'true' });
const base = { merchantId: MERCHANT, santaTenantMerchantId: MERCHANT };

describe('isSantaModeActive', () => {
  it('is on with the flag, December and the Santa store', () => {
    expect(isSantaModeActive({ ...base, env: on, now: DEC })).toBe(true);
  });

  it('is off without the flag, or with any value but true', () => {
    expect(isSantaModeActive({ ...base, env: env({}), now: DEC })).toBe(false);
    expect(
      isSantaModeActive({
        ...base,
        env: env({ EKAETTE_CHATWOOT_SANTA_ENABLED: '1' }),
        now: DEC,
      })
    ).toBe(false);
  });

  it('is off outside December', () => {
    expect(
      isSantaModeActive({
        ...base,
        env: on,
        now: new Date('2026-11-22T12:00:00Z'),
      })
    ).toBe(false);
  });

  it('is off for a store other than the Santa store, or none', () => {
    expect(
      isSantaModeActive({
        merchantId: MERCHANT,
        santaTenantMerchantId: '22222222-2222-4222-8222-222222222222',
        env: on,
        now: DEC,
      })
    ).toBe(false);
    expect(
      isSantaModeActive({
        merchantId: MERCHANT,
        santaTenantMerchantId: undefined,
        env: on,
        now: DEC,
      })
    ).toBe(false);
  });
});

describe('isDecemberInLagos', () => {
  it('uses Lagos time at the month edges', () => {
    // 23:30 UTC on 30 Nov is already 1 Dec in Lagos (UTC+1).
    expect(isDecemberInLagos(new Date('2026-11-30T23:30:00Z'))).toBe(true);
    expect(isDecemberInLagos(new Date('2026-12-31T23:30:00Z'))).toBe(false);
  });
});
