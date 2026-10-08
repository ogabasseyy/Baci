import { describe, expect, it } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';

describe('intake-only configured custody capability', () => {
  it('requires only scoped custody storage and signature credentials, not provider API or financial dispatch secrets', () => {
    const config = readPrimaryCardCustodyIntakeRuntime(
      {
        ...fixture.environment,
        PIGGYVEST_PRIMARY_CARD_PIGGYVEST_TOKEN: undefined,
        PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: undefined,
        PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: undefined,
      },
      fixture.now
    );
    expect(config?.intakeOnly).toBe(true);
    expect(config).not.toHaveProperty('apiToken');
    expect(config).not.toHaveProperty('transfer');
    expect(config?.signedInbox).not.toHaveProperty('batchSize');
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: undefined },
    { PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined },
    { PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-10-01T00:00:00Z' },
  ])('fails closed on unavailable signed intake scope %#', (change) => {
    expect(
      readPrimaryCardCustodyIntakeRuntime(
        { ...fixture.environment, ...change },
        fixture.now
      )
    ).toBeNull();
  });
});
