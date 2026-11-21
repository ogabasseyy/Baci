import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePartnerProfile } from './partner-profile';
import { getPartnerProfiles } from './partner-profiles';

const verifierToken = 'internal-verifier-token-synthetic-test-000001';
const catalogToken = 'partner-catalog-token-synthetic-test-0000001';
const teamToken = 'crossrem-team-feed-token-synthetic-test-00001';

describe('configured partner profiles', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the merchant catalog and internal verifier grants distinct', () => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', catalogToken);
    vi.stubEnv('CROSSREM_VERIFIER_TOKEN', verifierToken);
    const profiles = getPartnerProfiles();

    expect(
      authorizePartnerProfile(
        `Bearer ${catalogToken}`,
        'catalog:read',
        profiles
      )
    ).toMatchObject({ ok: true, connectionId: 'crossrem-ogabassey' });
    expect(
      authorizePartnerProfile(
        `Bearer ${catalogToken}`,
        'reconciliation:write',
        profiles
      )
    ).toEqual({ ok: false, reason: 'scope_required' });
    expect(
      authorizePartnerProfile(
        `Bearer ${verifierToken}`,
        'orders:write',
        profiles
      )
    ).toEqual({ ok: false, reason: 'scope_required' });
  });

  it('requires an explicit settlement policy', () => {
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', undefined);
    expect(getPartnerProfiles()[0].delivery.settlementBasis).toBeNull();
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', 'base_plus_delivery');
    expect(getPartnerProfiles()[0].delivery.settlementBasis).toBe(
      'base_plus_delivery'
    );
  });

  it('grants the CrossRem team read-only catalog access independently of the Baci token', () => {
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', catalogToken);
    vi.stubEnv('CROSSREM_PARTNER_CATALOG_TOKEN', teamToken);
    const authorize = (
      token: string,
      scope: Parameters<typeof authorizePartnerProfile>[1]
    ) =>
      authorizePartnerProfile(`Bearer ${token}`, scope, getPartnerProfiles());

    expect(authorize(teamToken, 'catalog:read')).toMatchObject({
      ok: true,
      connectionId: 'crossrem-ogabassey',
    });
    for (const scope of [
      'quotes:write',
      'orders:write',
      'orders:read',
      'reconciliation:write',
    ] as const) {
      expect(authorize(teamToken, scope)).toEqual({
        ok: false,
        reason: 'scope_required',
      });
    }
    vi.stubEnv('CROSSREM_PARTNER_CATALOG_TOKEN', undefined);
    expect(authorize(teamToken, 'catalog:read')).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(authorize(catalogToken, 'catalog:read')).toMatchObject({ ok: true });
  });
});
