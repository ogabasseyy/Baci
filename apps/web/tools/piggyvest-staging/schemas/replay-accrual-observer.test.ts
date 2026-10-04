import { afterEach, expect, it, vi } from 'vitest';
import { createPaidInterestTestFixture } from '../replay-paid-interest.test-support';
import { replayAccrualObserverSchemas as schemas } from './replay-accrual-observer';

function fixture() {
  const sample = createPaidInterestTestFixture();
  return {
    database: {
      ...sample.configuration.paidInterestDatabase,
      role: 'piggyvest_staging_ledger_worker',
    },
    wrapperDefinitionSha256: 'a'.repeat(64),
    originalDefinitionSha256: 'b'.repeat(64),
    executionDeadline: '2026-10-06T15:59:10Z',
  };
}

afterEach(() => vi.useRealTimers());

it('keeps the observer role and verifying TLS mandatory without accepting extra authority', () => {
  expect(schemas.observer.parse(fixture())).toEqual(fixture());
  for (const addition of [
    { role: 'prefunded_treasury_operator' },
    { host: 'baci-isolated-savings-db-1' },
    { ssl: undefined },
    { ssl: { ca: 'synthetic-ca', rejectUnauthorized: false } },
    { database: 'foreign' },
    { extra: true },
  ]) {
    const value = fixture();
    expect(
      schemas.observer.safeParse({
        ...value,
        database: { ...value.database, ...addition },
      }).success
    ).toBe(false);
  }
});

it('requires independent definition pins and the exact unexpired Oct6 deadline', () => {
  for (const addition of [
    { wrapperDefinitionSha256: 'bad' },
    { originalDefinitionSha256: undefined },
    { executionDeadline: '2026-10-07T15:59:10Z' },
    { extra: true },
  ])
    expect(
      schemas.observer.safeParse({ ...fixture(), ...addition }).success
    ).toBe(false);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:10Z'));
  expect(schemas.observer.safeParse(fixture()).success).toBe(false);
});

it('requires the real pinned factory scope and separate original webhook signing secret', () => {
  const sample = createPaidInterestTestFixture();
  const value = {
    scope: sample.scope,
    evidence: {
      integrationId: sample.scope.integrationId,
      systemIdentifier: sample.configuration.appSystemId,
      webhookSecret: 'synthetic-observation-signing-secret',
    },
  };
  expect(schemas.factoryConfiguration.parse(value)).toEqual(value);
  expect(
    schemas.factoryConfiguration.safeParse({ scope: sample.scope }).success
  ).toBe(false);
  expect(
    schemas.factoryConfiguration.safeParse({
      ...value,
      evidence: { ...value.evidence, webhookSecret: '' },
    }).success
  ).toBe(false);
});
