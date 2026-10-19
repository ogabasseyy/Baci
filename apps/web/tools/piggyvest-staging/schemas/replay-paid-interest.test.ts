import { expect, it } from 'vitest';
import { createPaidInterestTestFixture } from '../replay-paid-interest.test-support';
import { replayPaidInterestSchemas } from './replay-paid-interest';

it('retains exactly the existing treasury TLS profile and six-field factory scope', () => {
  const sample = createPaidInterestTestFixture();
  expect(
    replayPaidInterestSchemas.database.parse(
      sample.configuration.paidInterestDatabase
    )
  ).toEqual(sample.configuration.paidInterestDatabase);
  expect(
    replayPaidInterestSchemas.factoryConfiguration.parse(
      JSON.parse(sample.privateBytes.toString())
    )
  ).toEqual({ scope: sample.scope });
});

it.each([
  { batchSize: 10 },
  { expiresAt: '2026-10-06T15:59:10Z' },
  { environment: 'production' },
])('refuses invented or non-staging scope fields', (override) => {
  const sample = createPaidInterestTestFixture();
  expect(() =>
    replayPaidInterestSchemas.factoryConfiguration.parse({
      scope: { ...sample.scope, ...override },
    })
  ).toThrow();
});

it('refuses another AppDB and extra caller assertions in paid scope', () => {
  const sample = createPaidInterestTestFixture();
  const scope = {
    integrationId: sample.scope.integrationId,
    businessId: sample.scope.businessId,
    expectedSystemId: sample.scope.expectedSystemId,
  };
  expect(replayPaidInterestSchemas.scope.parse(scope)).toEqual(scope);
  expect(() =>
    replayPaidInterestSchemas.scope.parse({ ...scope, expectedSystemId: '1' })
  ).toThrow();
  expect(() =>
    replayPaidInterestSchemas.scope.parse({ ...scope, verified: true })
  ).toThrow();
});
