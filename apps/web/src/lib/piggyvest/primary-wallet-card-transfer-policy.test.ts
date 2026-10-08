import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { assertPrimaryCardTransferPolicy } from './primary-wallet-card-transfer-policy';

describe('approved issuer transfer policy (internal, not a provider signing contract)', () => {
  it('permits only configured approved reusable proof and current deployment scope', () =>
    expect(
      assertPrimaryCardTransferPolicy(fixture.configuration, fixture.now)
    ).toEqual(fixture.configuration));
  it('rejects forged signatures', () =>
    expect(() =>
      assertPrimaryCardTransferPolicy(
        { ...fixture.configuration, policySignature: '0'.repeat(64) },
        fixture.now
      )
    ).toThrow());
  it.each([
    { reusableBindingReady: false },
    { exhaustiveAliasContractApproved: false },
    { authority: 'operation_records_only' },
    { businessId: 'wrong' },
    { contractId: 'wrong' },
    { expiresAt: '2026-01-01T00:00:00Z' },
  ])('cannot activate financial dispatch from unavailable/static/foreign proof %#', (change) => {
    const policyBytes = JSON.stringify({ ...fixture.policy, ...change });
    expect(() =>
      assertPrimaryCardTransferPolicy(
        {
          ...fixture.configuration,
          policyBytes,
          policySignature: createHmac(
            'sha256',
            fixture.configuration.policyIssuerKey
          )
            .update(policyBytes)
            .digest('hex'),
        },
        fixture.now
      )
    ).toThrow();
  });
});
