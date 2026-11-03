import { describe, expect, it, type Mock, vi } from 'vitest';
import type { PiggyvestPrimaryExistingOnboarding } from '@/schemas/piggyvest-primary-wallet-capability';
import { resolvePrimaryOnboardingCapability } from './primary-onboarding-capability';
import {
  PRIMARY_READINESS_IDS,
  type PrimaryReadinessId,
  type PrimaryReadinessReader,
} from './primary-readiness-registry';
import {
  client,
  floors,
  refused,
} from './primary-wallet-capability.test-support';

vi.mock('server-only', () => ({}));

type ReaderMocks = Record<PrimaryReadinessId, Mock<PrimaryReadinessReader>>;

function registry(blocked?: PrimaryReadinessId): ReaderMocks {
  const readers = {} as ReaderMocks;
  for (const id of PRIMARY_READINESS_IDS)
    readers[id] = vi.fn<PrimaryReadinessReader>(async () => id !== blocked);
  return readers;
}

type OnboardingOverrides = {
  headers?: Headers;
  env?: NodeJS.ProcessEnv;
  existing?: () => Promise<PiggyvestPrimaryExistingOnboarding>;
  member?: () => Promise<boolean>;
  readers?: ReaderMocks;
};

function onboarding(overrides: OnboardingOverrides) {
  const readExistingOnboarding = vi.fn(
    overrides.existing ?? (async () => 'none' as const)
  );
  const readCohortMembership = vi.fn(overrides.member ?? (async () => true));
  const readers = overrides.readers ?? registry();
  const verdict = resolvePrimaryOnboardingCapability({
    headers: overrides.headers ?? client('ios', '120'),
    env: overrides.env ?? floors,
    refusalCode: 'PRIMARY_CARD_NOT_READY',
    readExistingOnboarding,
    readCohortMembership,
    registry: readers,
  });
  return { verdict, readExistingOnboarding, readCohortMembership, readers };
}

describe('resolvePrimaryOnboardingCapability', () => {
  it('enables onboarding for an at-floor cohort member when every reader is ready', async () => {
    const { verdict, readers } = onboarding({});
    await expect(verdict).resolves.toEqual({ enabled: true, basis: 'fresh' });
    for (const id of PRIMARY_READINESS_IDS)
      expect(readers[id]).toHaveBeenCalledOnce();
  });

  it.each([
    ['a missing header', client()],
    ['a malformed header', client('ios', '0120')],
    ['a below-floor build', client('ios', '119')],
  ])('refuses %s before any read', async (_label, headers) => {
    const { verdict, readExistingOnboarding, readCohortMembership, readers } =
      onboarding({ headers });
    await expect(verdict).resolves.toEqual(refused('client_build'));
    expect(readExistingOnboarding).not.toHaveBeenCalled();
    expect(readCohortMembership).not.toHaveBeenCalled();
    for (const id of PRIMARY_READINESS_IDS)
      expect(readers[id]).not.toHaveBeenCalled();
  });

  it.each([
    ['a verified customer', 'verified'],
    ['a customer with an in-flight onboarding', 'in_flight'],
  ] as const)('lets %s outside the cohort continue with only the floor', async (_label, existing) => {
    const { verdict, readCohortMembership, readers } = onboarding({
      existing: async () => existing,
      member: async () => false,
      readers: registry('interest_marker'),
    });
    await expect(verdict).resolves.toEqual({ enabled: true, basis: 'resume' });
    expect(readCohortMembership).not.toHaveBeenCalled();
    expect(readers.interest_marker).not.toHaveBeenCalled();
  });

  it.each(
    PRIMARY_READINESS_IDS
  )('lets an in-flight onboarding resume while %s is not ready', async (blocked) => {
    const { verdict, readers } = onboarding({
      existing: async () => 'in_flight',
      readers: registry(blocked),
    });
    await expect(verdict).resolves.toEqual({ enabled: true, basis: 'resume' });
    expect(readers[blocked]).not.toHaveBeenCalled();
  });

  it.each([
    'verified',
    'in_flight',
  ] as const)('still refuses a %s customer on an old build', async (existing) => {
    const { verdict, readExistingOnboarding } = onboarding({
      headers: client(),
      existing: async () => existing,
    });
    await expect(verdict).resolves.toEqual(refused('client_build'));
    expect(readExistingOnboarding).not.toHaveBeenCalled();
  });

  it('refuses a new customer outside the cohort without reading readiness', async () => {
    const { verdict, readers } = onboarding({ member: async () => false });
    await expect(verdict).resolves.toEqual(refused('rollout_cohort'));
    for (const id of PRIMARY_READINESS_IDS)
      expect(readers[id]).not.toHaveBeenCalled();
  });

  it.each(
    PRIMARY_READINESS_IDS
  )('refuses a cohort member while only %s is not ready', async (blocked) => {
    const { verdict } = onboarding({ readers: registry(blocked) });
    await expect(verdict).resolves.toEqual({
      ...refused('readiness'),
      missing: blocked,
    });
  });

  it('keeps onboarding closed with the shipped readers', async () => {
    const verdict = resolvePrimaryOnboardingCapability({
      headers: client('android', '700'),
      env: floors,
      refusalCode: 'PRIMARY_CARD_NOT_READY',
      readExistingOnboarding: async () => 'none',
      readCohortMembership: async () => true,
    });
    await expect(verdict).resolves.toEqual({
      ...refused('readiness'),
      missing: 'interest_marker',
    });
  });

  it('closes every build while either floor is unset, whatever the cohort', async () => {
    for (const env of [
      {},
      { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: '1' },
      { PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID: '1' },
    ])
      for (const headers of [
        client(),
        client('ios', '9999999999'),
        client('android', '9999999999'),
      ]) {
        const { verdict, readExistingOnboarding, readCohortMembership } =
          onboarding({
            env: env as NodeJS.ProcessEnv,
            headers,
            existing: async () => 'verified',
            member: async () => true,
          });
        await expect(verdict).resolves.toEqual(refused('build_floor_unset'));
        expect(readExistingOnboarding).not.toHaveBeenCalled();
        expect(readCohortMembership).not.toHaveBeenCalled();
      }
  });

  it.each([
    [
      'the existing-onboarding read fails',
      { existing: () => Promise.reject(new Error('db down')) },
    ],
    [
      'the cohort read fails',
      { member: () => Promise.reject(new Error('db down')) },
    ],
    [
      'a readiness reader fails',
      {
        readers: Object.assign(registry(), {
          spend_core: vi.fn<PrimaryReadinessReader>(() =>
            Promise.reject(new Error('db down'))
          ),
        }),
      },
    ],
  ])('reports unavailable, never a fallback code, when %s', async (_label, overrides) => {
    const { verdict } = onboarding(overrides);
    await expect(verdict).resolves.toEqual({
      enabled: false,
      status: 'unavailable',
      code: 'PIGGYVEST_UNAVAILABLE',
    });
  });

  const answer = <T>(value: unknown) =>
    (async () => value) as unknown as () => Promise<T>;

  it.each(
    [true, 'yes', 'VERIFIED', 'in-flight', 'ready', null].map(
      (value) => [JSON.stringify(value), value] as const
    )
  )('reports unavailable, never a cohort claim, for the unrecognised existing-onboarding answer %s', async (_label, value) => {
    const { verdict, readCohortMembership } = onboarding({
      existing: answer<PiggyvestPrimaryExistingOnboarding>(value),
      member: async () => true,
    });
    await expect(verdict).resolves.toEqual({
      enabled: false,
      status: 'unavailable',
      code: 'PIGGYVEST_UNAVAILABLE',
    });
    expect(readCohortMembership).not.toHaveBeenCalled();
  });

  it('does not open on a truthy non-boolean cohort answer', async () => {
    const { verdict } = onboarding({ member: answer<boolean>(1) });
    await expect(verdict).resolves.toEqual(refused('rollout_cohort'));
  });
});

describe('refusal code scope', () => {
  it('answers unavailable, never the cacheable base code, when the caller passes it', async () => {
    await expect(
      resolvePrimaryOnboardingCapability({
        headers: client('ios', '1'),
        env: floors,
        refusalCode: 'PIGGYVEST_NOT_READY' as unknown as 'SAVINGS_NOT_READY',
        readExistingOnboarding: async () => 'none',
        readCohortMembership: async () => false,
      })
    ).resolves.toMatchObject({ status: 'unavailable' });
  });
});
