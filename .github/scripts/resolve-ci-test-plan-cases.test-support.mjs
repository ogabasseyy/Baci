// Shared inputs for the planner class suites (`resolve-ci-test-plan-classes` for
// what skips the full suite, `resolve-ci-test-plan-triggers` for what keeps it).
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';

export const WEB_SOURCE = 'apps/web/src/lib/shipping/providers/gigl.booking.ts';
export const STOREFRONT_SOURCE =
  'apps/mobile-storefront/lib/fetch-with-timeout.ts';
export const FULL_COMMAND =
  'pnpm turbo run test --concurrency=3 --log-order=stream';
export const WEB_COMMAND =
  'pnpm --filter @baci/web exec vitest run --changed origin/main --passWithNoTests';
export const STOREFRONT_COMMAND =
  'pnpm --filter @baci/mobile-storefront exec jest --changedSince origin/main --runInBand --passWithNoTests';
export const OUTSIDE_SCOPE_REASON =
  'The diff includes files outside the targeted web test scope.';
export const TRIGGER_REASON =
  'Shared, package, CI, or test setup changes require the full affected test path.';
export const WEB_SOURCE_REASON =
  'Pull request changes are limited to apps/web source or test files.';
export const DELETED_SOURCE_REASON =
  'Deleted or renamed source files keep the full affected test path: unchanged tests may still import them.';
export const STOREFRONT_READER_REASON =
  'Mobile storefront changes next to files that tests read keep the full affected test path: storefront Jest cannot follow fs reads.';

export function plan(
  changedFiles,
  eventName = 'pull_request',
  deletedFiles = [],
  nonWebReaders = []
) {
  return resolveCiTestPlan({
    baseRef: 'origin/main',
    changedFiles,
    deletedFiles,
    eventName,
    nonWebReaders,
  });
}
