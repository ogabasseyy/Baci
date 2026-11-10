import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import {
  experienceFailure,
  experienceToolResult,
} from '@/schemas/experience-tool-results';
import {
  CandidatePerformanceBudgetError,
  EXPERIENCE_STARTER_PERFORMANCE_BUDGET,
} from './candidate-performance-budget';
import { createExperienceToolDispatcher } from './tool-dispatcher';

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
}));

const id = '11111111-1111-4111-8111-111111111111';
const identity: BuilderIdentity = {
  actorUserId: id,
  connectionId: id,
  grantVersion: 1,
  scopes: new Set(['storefront.read', 'storefront.write']),
  allowedMerchantIds: [id],
  allowCreateStore: false,
};
function dispatcher(
  finalizeBuild: () => Promise<{ buildId: string; buildDigest: string }>,
  rendering: 'client' | 'prerender-private' = 'client'
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { id, user_id: id },
      error: null,
    })),
  };
  const resolveUserClient = vi.fn(async () => ({ from: () => query }) as never);
  return createExperienceToolDispatcher({
    rendering,
    resolveUserClient,
    finalizeBuild: vi.fn(finalizeBuild),
    preview: vi.fn(async () => ({
      evidenceId: id,
      buildId: id,
      buildDigest: 'a'.repeat(64),
      previewUrl: 'https://store.example/preview',
    })),
  });
}

it('reports the fixed starter budget as a ceiling with LCP as guidance only', async () => {
  const run = dispatcher(async () => ({
    buildId: id,
    buildDigest: 'a'.repeat(64),
  }));
  const result = await run(identity, 'get_experience_capabilities', {
    storefrontId: id,
  });
  expect(result).toMatchObject({
    status: 'ok',
    value: {
      performance: {
        starterBudget: EXPERIENCE_STARTER_PERFORMANCE_BUDGET,
        lcpTargetMs: 2000,
        authoringRequirements: expect.arrayContaining([
          expect.stringContaining('deterministic'),
          expect.stringContaining('dimensions'),
          expect.stringContaining('React commit'),
        ]),
        fieldQualification: 'not-established',
      },
    },
  });
});

it('returns only the safe resource category for a typed budget rejection', async () => {
  const run = dispatcher(async () => {
    throw new CandidatePerformanceBudgetError('png-asset', 999999, 262144);
  });
  const result = await run(identity, 'finalize_experience_build', {
    storefrontId: id,
    jobId: id,
    idempotencyKey: id,
  });
  expect(result).toEqual({
    status: 'error',
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource: 'png-asset',
    error: 'Experience request unavailable.',
  });
  expect(JSON.stringify(result)).not.toContain('999999');
  expect(JSON.stringify(result)).not.toContain('262144');
  expect(experienceToolResult.parse(result)).toEqual(result);
});

it('requires a known resource only for performance-budget failures', () => {
  expect(
    experienceFailure.safeParse({
      status: 'error',
      code: 'PERFORMANCE_BUDGET_EXCEEDED',
      error: 'Experience request unavailable.',
    }).success
  ).toBe(false);
  expect(
    experienceFailure.safeParse({
      status: 'error',
      code: 'BUILD_FAILED',
      resource: 'png-asset',
      error: 'Experience request unavailable.',
    }).success
  ).toBe(false);
});
