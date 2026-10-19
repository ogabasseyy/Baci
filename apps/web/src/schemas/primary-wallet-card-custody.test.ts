import { describe, expect, it } from 'vitest';
import { primaryCardCustodyFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-custody.test-fixture';
import { primaryWalletCardCustodySchemas as schemas } from './primary-wallet-card-custody';

describe('goal independent custody schemas', () => {
  it('accepts a scoped operation and distinct role configuration without a goal', () => {
    expect(schemas.context.parse(fixture.context)).toEqual(fixture.context);
    expect(schemas.runtime.parse(fixture.configuration)).toEqual({
      ...fixture.configuration,
      retainedWebhookSecrets: [],
    });
    expect(schemas.crosswalk.parse(fixture.crosswalk)).toEqual(
      fixture.crosswalk
    );
  });
  it.each([
    { ...fixture.context, goalId: fixture.context.operationId },
    { ...fixture.context, amountKobo: 10000000000 },
    { ...fixture.context, amountKobo: 0 },
    { ...fixture.context, sourceWalletId: fixture.context.destinationWalletId },
    { ...fixture.context, reference: 'pvb-legacy-goal' },
  ])('rejects unsupported ownership or economics %#', (context) => {
    expect(schemas.context.safeParse(context).success).toBe(false);
  });
  it('rejects role substitution and non-exhaustive bank identity', () => {
    expect(
      schemas.runtime.safeParse({
        ...fixture.configuration,
        custody: fixture.configuration.transfer,
      }).success
    ).toBe(false);
    expect(
      schemas.crosswalk.safeParse({
        ...fixture.crosswalk,
        aliasesComplete: false,
      }).success
    ).toBe(false);
  });
});
