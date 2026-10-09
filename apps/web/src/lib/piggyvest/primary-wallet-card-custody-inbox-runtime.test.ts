import { describe, expect, it } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';

describe('explicit signed custody intake capability deployment', () => {
  it('requires approved payload and mapping contracts rather than inferring provider reference semantics', () => {
    expect(
      readPrimaryCardCustodyInboxRuntime(fixture.environment, fixture.now)
    ).toEqual({ ...fixture.configuration, retainedWebhookSecrets: [] });
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: undefined },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT: 'guessed' },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: undefined },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: '11' },
    { PIGGYVEST_PRIMARY_CARD_CROSSWALK_ISSUER: undefined },
    { PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-10-01T00:00:00Z' },
  ])('reports unavailable configuration %# without any network or storage', (change) => {
    expect(
      readPrimaryCardCustodyInboxRuntime(
        { ...fixture.environment, ...change },
        fixture.now
      )
    ).toBeNull();
  });
});
