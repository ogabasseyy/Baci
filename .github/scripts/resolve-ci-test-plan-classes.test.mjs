// Which pull requests keep the full 6-shard web suite, and which do not.
// The rule: a path may skip the full suite only if it belongs to a listed
// class; every unknown path keeps it (fail-safe).
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';

const WEB_SOURCE = 'apps/web/src/lib/shipping/providers/gigl.booking.ts';
const FULL_COMMAND = 'pnpm turbo run test --concurrency=3 --log-order=stream';
const WEB_COMMAND =
  'pnpm --filter @baci/web exec vitest run --changed origin/main --passWithNoTests';
const STOREFRONT_COMMAND =
  'pnpm --filter @baci/mobile-storefront exec jest --changedSince origin/main --runInBand --passWithNoTests';
const OUTSIDE_SCOPE_REASON =
  'The diff includes files outside the targeted web test scope.';
const TRIGGER_REASON =
  'Shared, package, CI, or test setup changes require the full affected test path.';

function plan(changedFiles, eventName = 'pull_request') {
  return resolveCiTestPlan({ baseRef: 'origin/main', changedFiles, eventName });
}

const WEB_SOURCE_REASON =
  'Pull request changes are limited to apps/web source or test files.';

// Test files directly in apps/web (Vitest runs them when they change) and
// Playwright specs (their own browser workflows run them) used to sit outside
// the web allow-list.
test('apps/web root test files next to web source no longer force the full suite', () => {
  for (const file of [
    'apps/web/next.config.routing.test.ts',
    'apps/web/graphql-tools-integrity.test.ts',
    'apps/web/root-flow.spec.ts',
  ]) {
    assert.deepEqual(plan([WEB_SOURCE, file]), {
      mode: 'targeted-web-vitest',
      reason: WEB_SOURCE_REASON,
      command: WEB_COMMAND,
    });
  }
});

test('Playwright specs next to web source no longer force the full suite', () => {
  for (const file of [
    'apps/web/tests/checkout-browser/contact.pw.ts',
    'apps/web/tests/oxygen-policy-browser/policy.pw.ts',
    'apps/web/e2e/signup.pw.ts',
  ]) {
    const result = plan([WEB_SOURCE, file]);

    assert.equal(result.mode, 'targeted-web-vitest', file);
    assert.equal(result.command, WEB_COMMAND, file);
  }
});

// Notes, docs, workflows and data files that no test, or only a few tests, read
// through fs. Each one used to push an otherwise web-only pull request onto the
// full suite; now the changed-files provider adds exactly the tests that read it.
const READ_BY_FEW_OR_NO_TESTS = [
  '.jules/atlas.md',
  '.jules/prompts/palette.md',
  'docs/audits/seo-aeo-20261025/report.md',
  'docs/architecture/storefront-authority-eligibility.md',
  'docs/product/baci-capabilities.json',
  'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.ruler/01-critical-rules.md',
  '.coderabbit.yaml',
  '.github/copilot-instructions.md',
  '.github/sarif-filter-notes.md',
  '.github/workflows/pilot-codec-compatibility.yml',
  '.github/filters/deploy.yml',
  'vps-workers/deploy.sh',
  'vercel.json',
  'apps/web/README.md',
];

for (const file of READ_BY_FEW_OR_NO_TESTS) {
  test(`${file} next to web source no longer forces the full suite`, () => {
    const result = plan([WEB_SOURCE, file]);

    assert.equal(result.mode, 'targeted-web-vitest');
    assert.equal(result.command, WEB_COMMAND);
    assert.match(result.reason, /files that tests read/);
  });
}

test('data files that tests read run through the web command and say so', () => {
  const result = plan([
    WEB_SOURCE,
    'docs/guides/ad-tracking-screenshot-review.md',
  ]);

  assert.equal(result.mode, 'targeted-web-vitest');
  assert.equal(result.command, WEB_COMMAND);
  assert.match(result.reason, /files that tests read/);
  assert.match(result.reason, /changed-files provider/);
});

test('a pull request that only touches files no test depends on is not sent to the shards', () => {
  for (const files of [
    ['.jules/atlas.md'],
    ['docs/audits/seo-aeo-20261025/report.md', '.jules/palette.md'],
    ['apps/web/tests/checkout-browser/contact.pw.ts'],
  ]) {
    assert.equal(plan(files).mode, 'targeted-web-vitest', files.join(', '));
  }
});

test('migration PR: SQL, SQL tests, replay registry and web code run the readers, not the full suite', () => {
  const result = plan([
    'supabase/migrations/20261111090000_merchant_cancel_order_refund_mode.sql',
    'supabase/tests/merchant_cancel_order_refund_mode.sql',
    'apps/web/tools/db/replay-registry/20261111090000_merchant_cancel_order_refund_mode/sql-checks.txt',
    'apps/web/src/lib/orders/cancel-order.ts',
    'apps/web/src/lib/orders/cancel-order.test.ts',
  ]);

  assert.equal(result.mode, 'targeted-web-vitest');
  assert.equal(result.command, WEB_COMMAND);
  assert.match(result.reason, /changed-files provider/);
});

test('migration-only PR with its replay registry entry stays on the targeted web command', () => {
  const result = plan([
    'supabase/migrations/20261111090000_merchant_cancel_order_refund_mode.sql',
    'apps/web/tools/db/replay-registry/20261111090000_merchant_cancel_order_refund_mode/pending-sources.txt',
  ]);

  assert.equal(result.mode, 'targeted-web-vitest');
});

test('a migration PR that also touches the mobile storefront runs both targeted suites', () => {
  const result = plan([
    'supabase/migrations/20261111090000_merchant_cancel_order_refund_mode.sql',
    'apps/mobile-storefront/lib/orders/cancel.ts',
  ]);

  assert.equal(result.mode, 'targeted-web-and-storefront-tests');
  assert.equal(result.command, `${WEB_COMMAND} && ${STOREFRONT_COMMAND}`);
  assert.match(result.reason, /changed-files provider/);
});

for (const file of [
  'apps/mobile-storefront/__tests__/checkout/contact.test.tsx',
  'apps/mobile-storefront/__mocks__/expo-secure-store.ts',
]) {
  test(`${file} runs the targeted storefront Jest command`, () => {
    assert.deepEqual(plan([file]), {
      mode: 'targeted-storefront-jest',
      reason:
        'Pull request changes are limited to mobile storefront source or test files.',
      command: STOREFRONT_COMMAND,
    });
  });
}

// The storefront package `test` script also runs `node --test config/*.test.mjs`,
// which Jest's default patterns skip: only the full path runs those suites.
test('storefront config suites and files keep the full suite', () => {
  for (const file of [
    'apps/mobile-storefront/config/android-release-config-loading.test.mjs',
    'apps/mobile-storefront/config/hosted-staging-push-app-config.json',
  ]) {
    assert.deepEqual(plan([file]), {
      mode: 'full-affected',
      reason: OUTSIDE_SCOPE_REASON,
      command: FULL_COMMAND,
    });
    assert.equal(plan([WEB_SOURCE, file]).mode, 'full-affected', file);
  }
});

// `vitest --changed` and Jest follow imports only: a fixture a test reads
// through fs (a text file, JSON, a snapshot) is invisible to them, so in the
// folders this planner newly targets only code files skip the full suite.
test('fixtures that tests read through fs keep the full suite in the newly targeted test folders', () => {
  for (const fixture of [
    'apps/web/tests/experience-commerce/polished-storefront.tsx.txt',
    'apps/web/tests/checkout-browser/fixtures/cart.json',
    'apps/web/tests/builder-chatgpt/page.html',
    'apps/mobile-storefront/__tests__/__snapshots__/checkout.test.tsx.snap',
    'apps/mobile-storefront/__mocks__/catalog.json',
  ]) {
    assert.deepEqual(
      plan([WEB_SOURCE, fixture]),
      {
        mode: 'full-affected',
        reason: OUTSIDE_SCOPE_REASON,
        command: FULL_COMMAND,
      },
      fixture
    );
  }
});

test('code files in the newly targeted test folders skip the full suite', () => {
  for (const file of [
    'apps/web/tests/checkout-browser/support/cart-page.ts',
    'apps/web/tests/builder-chatgpt/widget.test.tsx',
    'apps/web/tests/experience-browser/qualification.pw.ts',
  ]) {
    assert.equal(plan([file]).mode, 'targeted-web-vitest', file);
  }
  // The experience-browser folder was already targeted for every file type.
  assert.equal(
    plan(['apps/web/tests/experience-browser/fixture.txt']).mode,
    'targeted-web-vitest'
  );
});

test('mixed diff with one unknown file still gets the full suite', () => {
  for (const unknown of [
    'apps/mobile-admin/hooks/useOrders.ts',
    'tools/staging/primary-wallet-card-custody/package.mjs',
    'scripts/backfill-products.ts',
    'infra/cwv-runner/runner.mjs',
    'apps/web/.gitignore',
    'apps/web/tsconfig.build.json',
    'apps/web/sample_orphans.txt',
    'apps/web/public/fonts/inter.woff2',
    'patches/next@16.4.1.patch',
    '.github/scripts/run-ci-web-shard.sh',
    '.github/scripts/ci-lint-gate-contract.test.mjs',
  ]) {
    assert.deepEqual(
      plan([
        WEB_SOURCE,
        '.jules/atlas.md',
        'docs/audits/seo-aeo-20261025/report.md',
        'supabase/migrations/20261111090000_merchant_cancel_order_refund_mode.sql',
        unknown,
      ]),
      {
        mode: 'full-affected',
        reason: OUTSIDE_SCOPE_REASON,
        command: FULL_COMMAND,
      },
      unknown
    );
  }
});

test('a lone unknown file keeps the full suite even next to documentation', () => {
  assert.equal(
    plan(['docs/runbooks/contabo-private-ci.md', 'tools/test/run.mjs']).mode,
    'full-affected'
  );
});

test('markdown and Playwright specs inside workspace packages keep the full suite', () => {
  for (const unknown of [
    'apps/mobile-admin/README.md',
    'apps/mobile-storefront/docs/notes.md',
    'packages/tiktok-business/README.md',
    'apps/mobile-admin/e2e/login.pw.ts',
  ]) {
    assert.deepEqual(
      plan([WEB_SOURCE, unknown]),
      {
        mode: 'full-affected',
        reason: OUTSIDE_SCOPE_REASON,
        command: FULL_COMMAND,
      },
      unknown
    );
  }
});

test('hard triggers beat every class that skips the full suite', () => {
  for (const trigger of [
    '.github/workflows/ci.yml',
    '.github/actions/pnpm-install-cached/action.yml',
    '.github/scripts/resolve-ci-test-plan-paths.mjs',
    '.github/scripts/resolve-ci-test-plan-classes.test.mjs',
    '.github/scripts/vitest-changed-files-provider.mjs',
    '.github/scripts/vitest-changed-files-provider.test.mjs',
    'packages/shared/src/lib/index.ts',
    'packages/experience-sdk/src/channel.ts',
    'apps/web/package.json',
    'apps/web/vitest.config.ts',
    'apps/mobile-storefront/jest.setup.ts',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
  ]) {
    assert.deepEqual(
      plan([
        'docs/audits/seo-aeo-20261025/report.md',
        'supabase/migrations/20261111090000_x.sql',
        trigger,
      ]),
      { mode: 'full-affected', reason: TRIGGER_REASON, command: FULL_COMMAND },
      trigger
    );
  }
});

test('non-pull-request events keep the full suite even for documentation', () => {
  assert.equal(
    plan(['docs/audits/seo-aeo-20261025/report.md'], 'push').mode,
    'full-affected'
  );
  assert.equal(plan(['.jules/atlas.md'], 'merge_group').mode, 'full-affected');
});

test('an empty change list keeps the full suite', () => {
  assert.equal(plan([]).mode, 'full-affected');
});

test('a Turbo env addition next to a documentation note is no longer forced to the full suite', () => {
  const result = resolveCiTestPlan({
    baseRef: 'origin/main',
    changedFileContents: {
      'turbo.json': {
        before: { tasks: { build: { env: ['A'] } } },
        after: { tasks: { build: { env: ['A', 'B'] } } },
      },
    },
    changedFiles: ['turbo.json', 'docs/audits/seo-aeo-20261025/report.md'],
    eventName: 'pull_request',
  });

  assert.equal(result.mode, 'targeted-web-vitest');
});

test('Windows separators and leading ./ do not hide a class', () => {
  assert.equal(
    plan(['.\\docs\\audits\\report.md', './apps/web/src/a.ts']).mode,
    'targeted-web-vitest'
  );
  assert.equal(
    plan(['./docs/audits/report.md', './tools/x.mjs']).mode,
    'full-affected'
  );
});
