import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPaidInterestTestFixture } from '../replay-paid-interest.test-support';
import { parseReplayRuntimeConfig } from './replay-runtime-config';

beforeEach(() => {
  // Observer schemas pin a fixed execution deadline with a Date.now()
  // expiry refine: freeze before it so happy-path tests stay green
  // regardless of wall-clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  const sample = createPaidInterestTestFixture();
  return {
    ...sample.configuration,
    accrualObserver: {
      database: {
        ...sample.configuration.paidInterestDatabase,
        role: 'piggyvest_staging_ledger_worker',
      },
      wrapperDefinitionSha256: 'a'.repeat(64),
      originalDefinitionSha256: 'b'.repeat(64),
      executionDeadline: '2026-10-06T15:59:10Z',
    },
  };
}

it('accepts a separate observation-only TLS connection in the same paired claimant', () => {
  const configuration = fixture();
  expect(parseReplayRuntimeConfig(configuration)).toMatchObject({
    accrualObserver: configuration.accrualObserver,
    paidInterestDatabase: configuration.paidInterestDatabase,
  });
});

it.each([
  'integrationId',
  'businessId',
])('refuses observer %s outside the paired authority scope', (field) => {
  const configuration = fixture();
  configuration.accrualObserver.database = {
    ...configuration.accrualObserver.database,
    [field]:
      field === 'integrationId'
        ? '40000000-0000-4000-8000-000000000009'
        : 'different-business',
  };
  expect(() => parseReplayRuntimeConfig(configuration)).toThrow(
    'Staging replay configuration refused'
  );
});

it.each([
  'paidInterestDatabase',
  'prefundedReplay',
])('refuses an observer without %s', (field) => {
  expect(() =>
    parseReplayRuntimeConfig({ ...fixture(), [field]: undefined })
  ).toThrow('Staging replay configuration refused');
});

it.each([
  { interestAccrualSigningSecret: 'synthetic-interest-secret' },
  { financialDatabase: { ...fixture().paidInterestDatabase } },
])('retains every legacy financial/accrual separation guard', (addition) => {
  expect(() => parseReplayRuntimeConfig({ ...fixture(), ...addition })).toThrow(
    'Staging replay configuration refused'
  );
});
