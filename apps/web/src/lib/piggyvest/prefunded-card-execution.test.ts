import { expect, it, vi } from 'vitest';
import { createPrefundedCardExecution } from './prefunded-card-execution';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';

vi.mock('server-only', () => ({}));

function configuration() {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: [] }] });
  return {
    worker: {
      environment: 'staging',
      integrationId: fixture.claim.integrationId,
      merchantId: fixture.claim.merchantId,
      treasuryBindingId: fixture.claim.treasuryBindingId,
      businessId: fixture.claim.businessId,
      expectedSystemId: '123',
    },
    provider: fixture.providerSettings,
    evidence: {
      integrationId: fixture.claim.integrationId,
      systemIdentifier: '123',
      webhookSecret: 'fixture-webhook',
      piggyvest: fixture.providerSettings.piggyvest,
    },
    execute,
    evidenceExecute: vi.fn(),
    fetchImplementation: vi.fn(),
  };
}

it('composes real queue, stored authorization, evidence, runtime and projector without enabling a public charge', async () => {
  const options = configuration();
  const tick = createPrefundedCardExecution(options);
  expect(options.execute).not.toHaveBeenCalled();
  expect((await tick()).claimed).toBe(0);
  expect(options.fetchImplementation).not.toHaveBeenCalled();
  expect(options.evidenceExecute).not.toHaveBeenCalled();
});
it.each([
  'integrationId',
  'businessId',
  'expectedSystemId',
  'merchantId',
  'treasuryBindingId',
])('refuses independently mismatched %s before SQL or network', (key) => {
  const options = configuration();
  expect(() =>
    createPrefundedCardExecution({
      ...options,
      worker: { ...options.worker, [key]: 'wrong' },
    })
  ).toThrow('Prefunded execution unavailable');
  expect(options.execute).not.toHaveBeenCalled();
  expect(options.fetchImplementation).not.toHaveBeenCalled();
});
it('does not let receipt verification switch the PiggyVest credential', () => {
  const options = configuration();
  options.evidence.piggyvest = {
    ...options.evidence.piggyvest,
    apiSecret: 'other-private-credential',
  };
  expect(() => createPrefundedCardExecution(options)).toThrow(
    'Prefunded execution unavailable'
  );
  expect(options.execute).not.toHaveBeenCalled();
});
