import { describe, expect, it, vi } from 'vitest';
import {
  authorizePartnerProfile,
  type PartnerProfile,
} from './partner-profile';

const scopes = ['quotes:write'] as const;
const firstToken = 'partner-one-quote-token-synthetic-test-00001';
const secondToken = 'partner-two-quote-token-synthetic-test-00002';

function profile(
  id: string,
  merchantId: string,
  token: string
): PartnerProfile {
  return {
    id,
    merchantId,
    credentials: [{ token, scopes }],
    loadCatalog: vi.fn(),
    readCatalogSnapshot: vi.fn(),
    delivery: { carrier: 'GIGL', validityMs: 60_000, settlementBasis: null },
  };
}

describe('partner profile authorization', () => {
  it('resolves the merchant, catalog and delivery policy from the matching grant', () => {
    const first = profile('first', 'merchant-one', firstToken);
    const second = profile('second', 'merchant-two', secondToken);
    const result = authorizePartnerProfile(
      `Bearer ${secondToken}`,
      'quotes:write',
      [first, second]
    );

    expect(result).toEqual({
      ok: true,
      connectionId: 'second',
      merchantId: 'merchant-two',
      profile: second,
    });
    expect(first.loadCatalog).not.toHaveBeenCalled();
  });

  it('rejects a connection ID reused by another merchant', () => {
    expect(
      authorizePartnerProfile(`Bearer ${firstToken}`, 'quotes:write', [
        profile('shared-id', 'merchant-one', firstToken),
        profile('shared-id', 'merchant-two', secondToken),
      ])
    ).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('rejects a credential duplicated across merchant profiles', () => {
    expect(
      authorizePartnerProfile(`Bearer ${firstToken}`, 'quotes:write', [
        profile('first', 'merchant-one', firstToken),
        profile('second', 'merchant-two', firstToken),
      ])
    ).toEqual({ ok: false, reason: 'ambiguous' });
  });
});
