import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  PRIMARY_READINESS_IDS,
  type PrimaryReadinessId,
  type PrimaryReadinessReader,
} from './primary-readiness-registry';
import { resolvePrimaryOnboardingCapability } from './primary-wallet-capability';
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
  verified?: () => Promise<boolean>;
  member?: () => Promise<boolean>;
  readers?: ReaderMocks;
};

function onboarding(overrides: OnboardingOverrides) {
  const readVerifiedWallet = vi.fn(overrides.verified ?? (async () => false));
  const readCohortMembership = vi.fn(overrides.member ?? (async () => true));
  const readers = overrides.readers ?? registry();
  const verdict = resolvePrimaryOnboardingCapability({
    headers: overrides.headers ?? client('ios', '120'),
    env: overrides.env ?? floors,
    refusalCode: 'PIGGYVEST_NOT_READY',
    readVerifiedWallet,
    readCohortMembership,
    registry: readers,
  });
  return { verdict, readVerifiedWallet, readCohortMembership, readers };
}

describe('resolvePrimaryOnboardingCapability', () => {
  it('enables onboarding for an at-floor cohort member when every reader is ready', async () => {
    const { verdict, readers } = onboarding({});
    await expect(verdict).resolves.toEqual({ enabled: true });
    for (const id of PRIMARY_READINESS_IDS)
      expect(readers[id]).toHaveBeenCalledOnce();
  });

  it.each([
    ['a missing header', client()],
    ['a malformed header', client('ios', '0120')],
    ['a below-floor build', client('ios', '119')],
  ])('refuses %s before any read', async (_label, headers) => {
    const { verdict, readVerifiedWallet, readCohortMembership, readers } =
      onboarding({ headers });
    await expect(verdict).resolves.toEqual(refused('client_build'));
    expect(readVerifiedWallet).not.toHaveBeenCalled();
    expect(readCohortMembership).not.toHaveBeenCalled();
    for (const id of PRIMARY_READINESS_IDS)
      expect(readers[id]).not.toHaveBeenCalled();
  });

  it('lets a verified customer outside the cohort read with only the floor', async () => {
    const { verdict, readCohortMembership, readers } = onboarding({
      verified: async () => true,
      member: async () => false,
      readers: registry('interest_marker'),
    });
    await expect(verdict).resolves.toEqual({ enabled: true });
    expect(readCohortMembership).not.toHaveBeenCalled();
    expect(readers.interest_marker).not.toHaveBeenCalled();
  });

  it('still refuses a verified customer on an old build', async () => {
    const { verdict, readVerifiedWallet } = onboarding({
      headers: client(),
      verified: async () => true,
    });
    await expect(verdict).resolves.toEqual(refused('client_build'));
    expect(readVerifiedWallet).not.toHaveBeenCalled();
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
      refusalCode: 'PIGGYVEST_NOT_READY',
      readVerifiedWallet: async () => false,
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
        const { verdict, readVerifiedWallet, readCohortMembership } =
          onboarding({
            env: env as NodeJS.ProcessEnv,
            headers,
            verified: async () => true,
            member: async () => true,
          });
        await expect(verdict).resolves.toEqual(refused('build_floor_unset'));
        expect(readVerifiedWallet).not.toHaveBeenCalled();
        expect(readCohortMembership).not.toHaveBeenCalled();
      }
  });

  it.each([
    [
      'the verified-wallet read fails',
      { verified: () => Promise.reject(new Error('db down')) },
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

  const truthy = (value: unknown) =>
    (async () => value) as unknown as () => Promise<boolean>;

  it.each([
    [
      'a truthy non-boolean verified answer',
      { verified: truthy('yes'), member: async () => false },
    ],
    ['a truthy non-boolean cohort answer', { member: truthy(1) }],
  ] satisfies [
    string,
    OnboardingOverrides,
  ][])('does not open on %s', async (_label, overrides) => {
    const { verdict } = onboarding(overrides);
    await expect(verdict).resolves.toEqual(refused('rollout_cohort'));
  });
});
