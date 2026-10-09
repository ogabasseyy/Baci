import { describe, expect, it } from 'vitest';
import { primaryCardTransferFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-transfer.test-fixture';
import { primaryCardTransferProviderSchemas as schemas } from './primary-wallet-card-transfer-provider';

describe('restricted primary transfer configuration', () => {
  it('requires transfer authority without settlement credentials or a goal', () => {
    expect(schemas.configuration.parse(fixture.configuration)).toEqual({
      ...fixture.configuration,
      runtime: {
        ...fixture.configuration.runtime,
        retainedWebhookSecrets: [],
      },
    });
    expect(fixture.configuration.runtime).not.toHaveProperty('custody');
  });
  it('rejects missing transfer credentials', () =>
    expect(
      schemas.configuration.safeParse({
        ...fixture.configuration,
        runtime: { ...fixture.configuration.runtime, transfer: undefined },
      }).success
    ).toBe(false));
  it('does not mistake arbitrary success labels for accepted collection/custody', () => {
    expect(schemas.accepted.safeParse({ status: true }).success).toBe(true);
    expect(schemas.accepted.safeParse({ status: 'success' }).success).toBe(
      false
    );
  });
});
