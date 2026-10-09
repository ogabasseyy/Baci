import { describe, expect, it } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { readPrimaryCardTransferRuntime } from './primary-wallet-card-transfer-runtime';

describe('trusted isolated financial transfer deployment profile', () => {
  // Parsed runtimes carry the schema-default empty retained-key list.
  const parsed = {
    ...fixture.configuration,
    runtime: { ...fixture.configuration.runtime, retainedWebhookSecrets: [] },
  };
  it('binds current scope and approval without custody, intake, Paystack or a goal', () =>
    expect(
      readPrimaryCardTransferRuntime(fixture.environment, fixture.now)
    ).toEqual(parsed));
  it('drains pre-expiry transfers past the integration deadline', () =>
    expect(
      readPrimaryCardTransferRuntime(
        fixture.environment,
        Date.parse('2027-01-01T00:00:00Z')
      )
    ).toEqual(parsed));
  it.each([
    { PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES: undefined },
    { PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_SIGNATURE: '0'.repeat(64) },
    { PIGGYVEST_PRIMARY_CARD_CUSTODY_PASSWORD: 'forbidden' },
    { PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: 'forbidden' },
    { VERCEL_ENV: 'production' },
  ])('rejects unsigned/forbidden/mixed profile %#', (change) =>
    expect(
      readPrimaryCardTransferRuntime(
        { ...fixture.environment, ...change },
        fixture.now
      )
    ).toBeNull());
  it.each([
    { PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false' },
  ])('drains existing transfers while rollout flags are off %#', (change) =>
    expect(
      readPrimaryCardTransferRuntime(
        { ...fixture.environment, ...change },
        fixture.now
      )
    ).toEqual(parsed));
});
