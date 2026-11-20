import { describe, expect, it } from 'vitest';
import { authorizePartner, type PartnerConnection } from './partner-connection';

const catalogToken = 'synthetic-catalog-token-with-enough-entropy-for-tests';
const quoteToken = 'synthetic-quotes-token-with-enough-entropy-for-tests';
const connections = [
  {
    id: 'store-a-catalog',
    merchantId: 'store-a',
    token: catalogToken,
    scopes: ['catalog:read'],
  },
  {
    id: 'store-b-delivery',
    merchantId: 'store-b',
    token: quoteToken,
    scopes: ['quotes:write'],
  },
] satisfies PartnerConnection[];

describe('partner connection authorization', () => {
  it('derives the merchant and connection from the credential', () => {
    expect(
      authorizePartner(`Bearer ${quoteToken}`, connections, 'quotes:write')
    ).toEqual({
      ok: true,
      connectionId: 'store-b-delivery',
      merchantId: 'store-b',
    });
  });

  it('rejects catalog credentials for quote and order operations', () => {
    for (const scope of [
      'quotes:write',
      'orders:write',
      'orders:read',
    ] as const) {
      expect(
        authorizePartner(`Bearer ${catalogToken}`, connections, scope)
      ).toEqual({ ok: false, reason: 'scope_required' });
    }
  });

  it('rejects credentials that identify multiple connections', () => {
    expect(
      authorizePartner(
        `Bearer ${catalogToken}`,
        [connections[0], { ...connections[1], token: catalogToken }],
        'catalog:read'
      )
    ).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('distinguishes an unconfigured connection from an invalid credential', () => {
    expect(authorizePartner('Bearer short', [], 'catalog:read')).toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(
      authorizePartner(`Bearer ${catalogToken}`, [], 'catalog:read')
    ).toEqual({ ok: false, reason: 'unconfigured' });
    expect(
      authorizePartner(`Bearer ${quoteToken}`, [connections[0]], 'catalog:read')
    ).toEqual({ ok: false, reason: 'unauthorized' });
  });
});
