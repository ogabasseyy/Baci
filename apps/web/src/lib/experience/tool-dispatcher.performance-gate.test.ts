import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  experienceFailure,
  experiencePerformanceQualificationError,
  experienceToolResult,
} from '@/schemas/experience-tool-results';
import { EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY } from './candidate-performance-qualification';
import { createExperienceToolDispatcher } from './tool-dispatcher';

const f = vi.hoisted(() => ({
  read: vi.fn(),
  publish: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
}));
vi.mock('./performance-read', () => ({
  readExperiencePerformance: f.read,
}));
vi.mock('./publication-service', () => ({
  requestExperiencePublication: f.publish,
}));
vi.mock('./rollback-service', () => ({
  requestExperienceRollback: f.rollback,
}));

const id = '11111111-1111-4111-8111-111111111111';
const identity: BuilderIdentity = {
  actorUserId: id,
  connectionId: id,
  grantVersion: 1,
  scopes: new Set([
    'storefront.read',
    'storefront.write',
    'storefront.publish',
  ]),
  allowedMerchantIds: [id],
  allowCreateStore: false,
};
const success = {
  buildId: id,
  status: 'lab-only',
  qualification: {
    status: 'passed',
    policyId: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id,
    buildDigest: 'a'.repeat(64),
    sourceDigest: 'b'.repeat(64),
    reportDigest: 'c'.repeat(64),
    routeCount: 2,
    sampleCount: 12,
    cwvQualified: false,
    releaseQualified: false,
  },
};
const failure = (reason = 'lcp-threshold') => ({
  buildId: id,
  status: 'lab-only',
  qualification: {
    status: 'failed',
    policyId: EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id,
    reason,
    cwvQualified: false,
    releaseQualified: false,
  },
});
const publicationInput = {
  storefrontId: id,
  buildId: id,
  expectedDraftVersion: 1,
  expectedPublishedVersion: 2,
  idempotencyKey: id,
};

const previewResult = {
  evidenceId: id,
  buildId: id,
  buildDigest: 'a'.repeat(64),
  previewUrl: 'https://store.example/preview',
};

function dispatcher(preview = vi.fn(async () => previewResult)) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { id, user_id: id },
      error: null,
    })),
  };
  return createExperienceToolDispatcher({
    resolveUserClient: vi.fn(async () => ({ from: () => query }) as never),
    finalizeBuild: vi.fn(async () => ({
      buildId: id,
      buildDigest: 'a'.repeat(64),
    })),
    preview,
    readPerformance: vi.fn(async () => undefined),
  });
}

it('blocks publication on missing or failed qualification before requesting approval', async () => {
  const run = dispatcher();
  f.publish.mockClear();
  f.read.mockResolvedValueOnce({
    buildId: id,
    status: 'not-measured',
    qualification: { status: 'not-measured' },
  });
  expect(
    await run(identity, 'publish_experience', publicationInput)
  ).toMatchObject({
    status: 'error',
    code: 'PERFORMANCE_NOT_QUALIFIED',
    reason: 'missing-metrics',
  });
  expect(f.read).toHaveBeenLastCalledWith(
    expect.anything(),
    id,
    expect.any(Function),
    'storefront.publish'
  );
  expect(f.publish).not.toHaveBeenCalled();

  f.read.mockResolvedValueOnce(failure('contaminated'));
  expect(
    await run(identity, 'publish_experience', publicationInput)
  ).toMatchObject({
    status: 'error',
    code: 'PERFORMANCE_NOT_QUALIFIED',
    reason: 'contaminated',
  });
  expect(f.publish).not.toHaveBeenCalled();
});

it('requests publication approval only after the owner-bound report qualifies', async () => {
  const run = dispatcher();
  f.read.mockResolvedValueOnce(success);
  f.publish.mockResolvedValueOnce({ status: 'pending-owner-confirmation' });

  expect(await run(identity, 'publish_experience', publicationInput)).toEqual({
    status: 'ok',
    value: { status: 'pending-owner-confirmation' },
  });
  expect(f.publish).toHaveBeenCalledOnce();
});

it('keeps preview available as a diagnostic and returns only a safe qualification summary', async () => {
  const run = dispatcher();
  f.read.mockResolvedValueOnce(failure('cls-threshold'));
  const result = await run(identity, 'preview_experience', {
    storefrontId: id,
    buildId: id,
    routeId: 'home',
    idempotencyKey: id,
  });

  expect(result).toMatchObject({
    status: 'ok',
    value: {
      evidenceId: id,
      performance: {
        status: 'lab-only',
        qualification: {
          status: 'failed',
          reason: 'cls-threshold',
          cwvQualified: false,
          releaseQualified: false,
        },
      },
    },
  });
  expect(JSON.stringify(result)).not.toContain('report');
});

it('does not apply the performance gate to rollback recovery', async () => {
  const run = dispatcher();
  f.read.mockClear();
  f.rollback.mockResolvedValueOnce({ status: 'pending-owner-confirmation' });

  expect(
    await run(identity, 'rollback_experience', {
      ...publicationInput,
      expectedDraftVersion: 2,
      expectedPublishedVersion: 3,
    })
  ).toMatchObject({ status: 'ok' });
  expect(f.read).not.toHaveBeenCalled();
  expect(f.rollback).toHaveBeenCalledOnce();
});

it('exposes the fixed route-family measurement policy without a field qualification claim', async () => {
  const run = dispatcher();
  expect(
    await run(identity, 'get_experience_capabilities', { storefrontId: id })
  ).toMatchObject({
    status: 'ok',
    value: {
      performance: {
        qualificationPolicyId: 'chromium-native-reference/v1',
        routeCoverage: 'one-representative-per-declared-route-family',
        lcpTargetMs: 2000,
        lcpStatistic: 'median-per-route-and-width',
        fieldQualification: 'not-established',
        productionQualification: 'not-established',
      },
    },
  });
});

it('serializes only known safe qualification reasons', () => {
  const safe = experiencePerformanceQualificationError('route-matrix-mismatch');
  expect(experienceToolResult.parse(safe)).toEqual(safe);
  expect(
    experienceFailure.safeParse({
      ...safe,
      reason: 'raw browser console error',
    }).success
  ).toBe(false);
  expect(
    experienceFailure.safeParse({
      ...safe,
      detail: 'raw provider output',
    }).success
  ).toBe(false);
});

it.each([
  'STALE_SOURCE',
  'NOT_FOUND',
  'INSUFFICIENT_SCOPE',
])('does not create a preview when performance read fails with %s', async (code) => {
  const preview = vi.fn(async () => previewResult);
  const run = dispatcher(preview);
  f.read.mockRejectedValueOnce(new Error(code));
  await expect(
    run(identity, 'preview_experience', {
      storefrontId: id,
      buildId: id,
      routeId: 'home',
      idempotencyKey: id,
    })
  ).resolves.toMatchObject({ status: 'error', code });
  expect(preview).not.toHaveBeenCalled();
});
