import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';

test('targets Vitest changed tests for pull requests with only local web source changes', () => {
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: [
        'apps/web/src/lib/shipping/providers/gigl.booking.ts',
        'apps/web/src/lib/shipping/providers/gigl.booking.test.ts',
      ],
      eventName: 'pull_request',
    }),
    {
      mode: 'targeted-web-vitest',
      reason:
        'Pull request changes are limited to apps/web source or test files.',
      command:
        'pnpm --filter @baci/web exec vitest run --changed origin/main --passWithNoTests',
    }
  );
});

test('targets Jest changed tests for pull requests with only mobile storefront source changes', () => {
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: [
        'apps/mobile-storefront/components/checkout/checkout-shipping.helpers.ts',
        'apps/mobile-storefront/components/checkout/checkout-shipping.helpers.test.ts',
      ],
      eventName: 'pull_request',
    }),
    {
      mode: 'targeted-storefront-jest',
      reason:
        'Pull request changes are limited to mobile storefront source or test files.',
      command:
        'pnpm --filter @baci/mobile-storefront exec jest --changedSince origin/main --runInBand --passWithNoTests',
    }
  );
});

test('targets web and mobile storefront changed tests for mixed source changes', () => {
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: [
        'apps/web/src/lib/shipping/providers/gigl.booking.ts',
        'apps/mobile-storefront/components/checkout/checkout-shipping.helpers.ts',
      ],
      eventName: 'pull_request',
    }),
    {
      mode: 'targeted-web-and-storefront-tests',
      reason:
        'Pull request changes are limited to apps/web and mobile storefront source or test files.',
      command:
        'pnpm --filter @baci/web exec vitest run --changed origin/main --passWithNoTests && pnpm --filter @baci/mobile-storefront exec jest --changedSince origin/main --runInBand --passWithNoTests',
    }
  );
});

test('keeps full affected tests when shared packages change', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: ['packages/shared/src/lib/negotiation-contact.ts'],
      eventName: 'pull_request',
    }).mode,
    'full-affected'
  );
});

test('keeps full affected tests when web test setup changes', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: ['apps/web/vitest.setup.ts'],
      eventName: 'pull_request',
    }).mode,
    'full-affected'
  );
});

test('keeps full affected tests when the web node/jsdom project split changes', () => {
  // These files decide which environment and setup every web test gets, so a
  // targeted `vitest --changed` run cannot prove a change to them is safe.
  for (const file of [
    'apps/web/vitest.config.ts',
    'apps/web/vitest.escape-glob.ts',
    'apps/web/vitest.jsdom-holdouts.ts',
    'apps/web/vitest.next-image-mock.ts',
    'apps/web/vitest.node-folders.ts',
    'apps/web/vitest.setup.node.ts',
    'apps/web/vitest.setup.shared.ts',
  ]) {
    const plan = resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: [file],
      eventName: 'pull_request',
    });
    assert.equal(plan.mode, 'full-affected', file);
    // The explicit trigger reason, not the "outside the targeted scope"
    // fall-through that any unknown path would also hit.
    assert.match(plan.reason, /test setup changes/, file);
  }
});

test('targets the tests that read replay registry lists instead of the full suite', () => {
  // Registry lists are read through fs, which a plain `vitest --changed` cannot
  // follow. The Vitest changed-files provider (vitest-changed-files-provider.mjs)
  // adds the tests that mention the registry, so the targeted run is enough.
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: [
        'apps/web/tools/db/replay-registry/20261101090000_goals/pending-sources.txt',
      ],
      eventName: 'pull_request',
    }),
    {
      mode: 'targeted-web-vitest',
      reason:
        'Pull request changes are limited to apps/web source or test files and files that tests read; the Vitest changed-files provider adds the tests that read them.',
      command:
        'pnpm --filter @baci/web exec vitest run --changed origin/main --passWithNoTests',
    }
  );
});

test('keeps full affected tests when mobile storefront test setup changes', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: ['apps/mobile-storefront/jest.setup.ts'],
      eventName: 'pull_request',
    }).mode,
    'full-affected'
  );
});

test('keeps full affected tests when CI test planning changes', () => {
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: ['.github/scripts/resolve-ci-test-plan-config.mjs'],
      eventName: 'pull_request',
    }),
    {
      mode: 'full-affected',
      reason:
        'Shared, package, CI, or test setup changes require the full affected test path.',
      command: 'pnpm turbo run test --concurrency=3 --log-order=stream',
    }
  );
});

test('uses config smoke tests when turbo build env only adds allowlist entries', () => {
  assert.deepEqual(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFileContents: {
        'turbo.json': {
          before: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL'],
                outputs: ['dist/**'],
              },
            },
          },
          after: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL', 'GIGL_EMAIL'],
                outputs: ['dist/**'],
              },
            },
          },
        },
      },
      changedFiles: ['turbo.json'],
      eventName: 'pull_request',
    }),
    {
      mode: 'config-smoke',
      reason:
        'Pull request changes only add Turbo build environment allowlist entries.',
      command:
        'pnpm exec biome check turbo.json .github/scripts/resolve-ci-test-plan.mjs .github/scripts/resolve-ci-test-plan.test.mjs .github/scripts/resolve-ci-test-plan-config.mjs .github/scripts/resolve-ci-test-plan-config.test.mjs && node --test .github/scripts/resolve-ci-test-plan.test.mjs .github/scripts/resolve-ci-test-plan-config.test.mjs',
    }
  );
});

test('keeps full affected tests when turbo build env removes allowlist entries', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFileContents: {
        'turbo.json': {
          before: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL', 'GIGL_EMAIL'],
              },
            },
          },
          after: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL'],
              },
            },
          },
        },
      },
      changedFiles: ['turbo.json'],
      eventName: 'pull_request',
    }).mode,
    'full-affected'
  );
});

test('keeps full affected tests when turbo build task changes outside env', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFileContents: {
        'turbo.json': {
          before: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL'],
                outputs: ['dist/**'],
              },
            },
          },
          after: {
            tasks: {
              build: {
                env: ['NEXT_PUBLIC_SUPABASE_URL', 'GIGL_EMAIL'],
                outputs: ['dist/**', '.next/**'],
              },
            },
          },
        },
      },
      changedFiles: ['turbo.json'],
      eventName: 'pull_request',
    }).mode,
    'full-affected'
  );
});

test('keeps full tests outside pull request events', () => {
  assert.equal(
    resolveCiTestPlan({
      baseRef: 'origin/main',
      changedFiles: ['apps/web/src/lib/shipping/providers/gigl.booking.ts'],
      eventName: 'merge_group',
    }).mode,
    'full-affected'
  );
});
