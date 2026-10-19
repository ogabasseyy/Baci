import { expect, it } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from '@/lib/piggyvest/primary-wallet-card-checkout.test-fixture';
import { primaryWalletCardCheckoutRuntimeSchema as schema } from './primary-wallet-card-checkout-runtime';

it('requires separate fixed authorizer and evidence logins', () => {
  const runtime = {
    settings: fixture.settings,
    authorizer: { ...fixture.database, login: 'baci_primary_card_authorizer' },
    evidence: { ...fixture.database, login: 'baci_primary_card_evidence' },
  };
  expect(schema.safeParse(runtime).success).toBe(true);
  expect(
    schema.safeParse({
      ...runtime,
      evidence: { ...runtime.evidence, login: 'baci_primary_card_authorizer' },
    }).success
  ).toBe(false);
});
