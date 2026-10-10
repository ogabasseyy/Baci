import { describe, expect, it } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import {
  readPrimaryCardCustodyIntakeRuntime,
  readPrimaryCardCustodyIntakeSecrets,
} from './primary-wallet-card-custody-intake-runtime';

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
  it('exposes the signing key while intake provisioning stays incomplete', () => {
    const env = {
      ...fixture.environment,
      PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined,
    };
    expect(readPrimaryCardCustodyIntakeSecrets(env)).toEqual({
      webhookSecret:
        fixture.environment.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
      retainedWebhookSecrets: [],
    });
    expect(readPrimaryCardCustodyIntakeRuntime(env, fixture.now)).toBeNull();
    expect(
      readPrimaryCardCustodyIntakeSecrets({
        ...fixture.environment,
        PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET: undefined,
      })
    ).toBeNull();
  });
  it('drains in-flight custody past the integration deadline', () => {
    expect(
      readPrimaryCardCustodyIntakeRuntime(
        fixture.environment,
        Date.parse('2100-01-01T00:00:00Z')
      )
    ).not.toBeNull();
  });
  it('keeps signing keys available while intake processing is rolled back', () => {
    for (const change of [
      { PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED: 'false' },
      { PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false' },
    ]) {
      const env = { ...fixture.environment, ...change };
      expect(readPrimaryCardCustodyIntakeSecrets(env)).toEqual({
        webhookSecret:
          fixture.environment.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
        retainedWebhookSecrets: [],
      });
      expect(readPrimaryCardCustodyIntakeRuntime(env, fixture.now)).toBeNull();
    }
  });
  it('exposes configured retained keys so rotation retries verify', () => {
    const env = {
      ...fixture.environment,
      PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS: JSON.stringify(
        ['retained-custody-key']
      ),
    };
    expect(readPrimaryCardCustodyIntakeSecrets(env)).toEqual({
      webhookSecret:
        fixture.environment.PIGGYVEST_PRIMARY_CARD_PIGGYVEST_WEBHOOK_SECRET,
      retainedWebhookSecrets: ['retained-custody-key'],
    });
    expect(
      readPrimaryCardCustodyIntakeRuntime(env, fixture.now)
        ?.retainedWebhookSecrets
    ).toEqual(['retained-custody-key']);
  });
  it('fails secrets closed on malformed rotation config', () => {
    const env = {
      ...fixture.environment,
      PIGGYVEST_PRIMARY_CARD_RETAINED_PIGGYVEST_WEBHOOK_SECRETS:
        'malformed-secret-value',
    };
    // No partial key set: verifying with the current key alone would
    // 200-ack a retained-signed delivery as invalid before the intake's
    // own 503 could save it. The union maps the throw to unconfigured.
    expect(() => readPrimaryCardCustodyIntakeSecrets(env)).toThrow(
      /secrets unavailable/
    );
    expect(readPrimaryCardCustodyIntakeRuntime(env, fixture.now)).toBeNull();
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED: 'false' },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT: undefined },
    { PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined },
  ])('fails closed on unavailable signed intake scope %#', (change) => {
    expect(
      readPrimaryCardCustodyIntakeRuntime(
        { ...fixture.environment, ...change },
        fixture.now
      )
    ).toBeNull();
  });
});
