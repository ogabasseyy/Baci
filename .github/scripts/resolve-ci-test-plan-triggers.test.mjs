// What keeps the full 6-shard web suite: every unknown path, CI wiring, shared
// packages, fixtures that import-following cannot see, and non-pull-request
// events. One such path in a diff is enough (fail-safe).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELETED_SOURCE_REASON,
  FULL_COMMAND,
  OUTSIDE_SCOPE_REASON,
  plan,
  STOREFRONT_READER_REASON,
  STOREFRONT_SOURCE,
  TRIGGER_REASON,
  WEB_SOURCE,
} from './resolve-ci-test-plan-cases.test-support.mjs';

const FULL_OUTSIDE_SCOPE = {
  mode: 'full-affected',
  reason: OUTSIDE_SCOPE_REASON,
  command: FULL_COMMAND,
};

// The storefront package `test` script also runs `node --test config/*.test.mjs`,
// which Jest's default patterns skip: only the full path runs those suites.
test('storefront config suites and files keep the full suite', () => {
  for (const file of [
    'apps/mobile-storefront/config/android-release-config-loading.test.mjs',
    'apps/mobile-storefront/config/hosted-staging-push-app-config.json',
  ]) {
    assert.deepEqual(plan([file]), FULL_OUTSIDE_SCOPE);
    assert.equal(plan([WEB_SOURCE, file]).mode, 'full-affected', file);
  }
});

// Jest's `--changedSince` follows imports only, and the changed-files provider
// feeds Vitest alone, so storefront tests that read a data file (a release
// workflow, a doc, a migration) are not selected. When the storefront package
// changes next to such a file, only the full path runs its whole test script.
test('mobile storefront changes next to files that tests read keep the full suite', () => {
  for (const reader of [
    '.github/workflows/android-storefront-release.yml',
    'supabase/migrations/20261111090000_merchant_cancel_order_refund_mode.sql',
    'docs/audits/seo-aeo-20261025/report.md',
    'vercel.json',
    'apps/web/tools/db/replay-registry/20261111090000_x/sql-checks.txt',
  ]) {
    assert.deepEqual(
      plan([WEB_SOURCE, STOREFRONT_SOURCE, reader]),
      {
        mode: 'full-affected',
        reason: STOREFRONT_READER_REASON,
        command: FULL_COMMAND,
      },
      reader
    );
    assert.equal(
      plan([STOREFRONT_SOURCE, reader]).mode,
      'full-affected',
      reader
    );
  }
});

test('the same data files without storefront changes stay on the targeted web command', () => {
  assert.equal(
    plan([WEB_SOURCE, '.github/workflows/android-storefront-release.yml']).mode,
    'targeted-web-vitest'
  );
  assert.equal(plan([STOREFRONT_SOURCE]).mode, 'targeted-storefront-jest');
  assert.equal(
    plan([STOREFRONT_SOURCE, WEB_SOURCE]).mode,
    'targeted-web-and-storefront-tests'
  );
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
    'apps/mobile-storefront/__mocks__/expo-secure-store.js',
  ]) {
    assert.deepEqual(plan([WEB_SOURCE, fixture]), FULL_OUTSIDE_SCOPE, fixture);
  }
});

// Several of these folders are excluded from the default Vitest run (see
// `exclude` in apps/web/vitest.config.ts) and run through their own scripts, so
// a targeted `vitest --changed` run would pass without running them. They keep
// the full suite exactly as before this change.
test('the other apps/web/tests folders keep the full suite', () => {
  for (const file of [
    'apps/web/tests/builder-chatgpt/widget.test.tsx',
    'apps/web/tests/builder-chatgpt/experience-upload.test.ts',
    'apps/web/tests/experience-authoring/draft.ts',
    'apps/web/tests/experience-commerce/cart.node.test.ts',
    'apps/web/tests/experience-durable/state.ts',
    'apps/web/tests/experience-lifecycle/plan.ts',
    'apps/web/tests/experience-performance/budget.ts',
    'apps/web/tests/typecheck/cart.tsx',
  ]) {
    assert.deepEqual(plan([WEB_SOURCE, file]), FULL_OUTSIDE_SCOPE, file);
  }
});

// Vitest reruns its whole suite when any package.json or Vite/Vitest config is in
// the changed list. A targeted plan would run every test in the single unsharded
// job (about 10,800 tests), so these go to the sharded full path wherever they sit.
test('any package.json or Vite/Vitest config keeps the sharded full suite', () => {
  for (const file of [
    'vps-workers/package.json',
    'apps/web/tools/builder-auth/package.json',
    'apps/web/mcp-server/widgets/package.json',
    'apps/web/tests/checkout-browser/harness/package.json',
    'docs/examples/package.json',
    'apps/web/vite.config.ts',
    'apps/web/tools/experience-runner/vitest.config.mjs',
  ]) {
    assert.deepEqual(
      plan([WEB_SOURCE, file]),
      { mode: 'full-affected', reason: TRIGGER_REASON, command: FULL_COMMAND },
      file
    );
  }
});

// Neither `vitest --changed` nor Jest can select an unchanged test that still
// imports a deleted module (the import no longer resolves), so the deletion of
// source code keeps the full suite. The old filter hid deletions altogether.
test('deleting or renaming away a source file keeps the full suite', () => {
  for (const removed of [
    'apps/web/src/lib/old-module.ts',
    'apps/web/tools/cost/old-helper.ts',
    'apps/mobile-storefront/components/OldCard.tsx',
    'apps/web/src/lib/__fixtures__/catalog.json',
    // A helper next to the Playwright specs is imported by them, unlike a spec.
    'apps/web/tests/checkout-browser/cart-helpers.ts',
  ]) {
    assert.deepEqual(
      plan([WEB_SOURCE, removed], 'pull_request', [removed]),
      {
        mode: 'full-affected',
        reason: DELETED_SOURCE_REASON,
        command: FULL_COMMAND,
      },
      removed
    );
  }
  // A deletion-only pull request is no exception.
  assert.equal(
    plan(['apps/web/src/lib/old-module.ts'], 'pull_request', [
      'apps/web/src/lib/old-module.ts',
    ]).mode,
    'full-affected'
  );
});

test('deleting tests, docs, migrations or registry entries does not keep the full suite', () => {
  const expectedMode = {
    'apps/web/src/lib/old-module.test.ts': 'targeted-web-vitest',
    'apps/mobile-storefront/__tests__/old.test.tsx':
      'targeted-web-and-storefront-tests',
    'docs/audits/old-report.md': 'targeted-web-vitest',
    'supabase/migrations/20261111090000_never_applied.sql':
      'targeted-web-vitest',
    'apps/web/tools/db/replay-registry/20261111090000_x/sql-checks.txt':
      'targeted-web-vitest',
    'apps/web/tests/checkout-browser/cart.pw.ts': 'targeted-web-vitest',
    'apps/web/tests/oxygen-policy-browser/oxygen-policy.pw.ts':
      'targeted-web-vitest',
    'apps/web/tests/oxygen-cookie-harness/oxygen-cookie.pw.ts':
      'targeted-web-vitest',
  };

  for (const [removed, mode] of Object.entries(expectedMode)) {
    assert.equal(
      plan([WEB_SOURCE, removed], 'pull_request', [removed]).mode,
      mode,
      removed
    );
  }
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
      FULL_OUTSIDE_SCOPE,
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
    assert.deepEqual(plan([WEB_SOURCE, unknown]), FULL_OUTSIDE_SCOPE, unknown);
  }
});

// A Playwright spec is validated by the browser workflow, which only covers the
// folders it lists (a contract test pins that); a spec anywhere else is unknown.
test('Playwright specs outside the browser-workflow folders keep the full suite', () => {
  for (const file of [
    'apps/web/e2e/signup.pw.ts',
    'apps/web/playwright/cart.pw.ts',
  ]) {
    assert.deepEqual(plan([WEB_SOURCE, file]), FULL_OUTSIDE_SCOPE, file);
  }
});

test('hard triggers beat every class that skips the full suite', () => {
  for (const trigger of [
    '.github/workflows/ci.yml',
    '.github/actions/pnpm-install-cached/action.yml',
    '.github/scripts/resolve-ci-test-plan-paths.mjs',
    '.github/scripts/resolve-ci-test-plan-classes.test.mjs',
    '.github/scripts/resolve-ci-test-plan-triggers.test.mjs',
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
