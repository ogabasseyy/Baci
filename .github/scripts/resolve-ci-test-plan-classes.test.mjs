// Which pull requests leave the full 6-shard web suite. A path may skip the full
// suite only if it belongs to a listed class (`resolve-ci-test-plan-triggers`
// covers what keeps it).
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';
import {
  plan,
  STOREFRONT_COMMAND,
  WEB_COMMAND,
  WEB_SOURCE,
  WEB_SOURCE_REASON,
} from './resolve-ci-test-plan-cases.test-support.mjs';

// Test files directly in apps/web (Vitest runs them when they change) and
// Playwright specs in the browser-workflow folders (checkout-browser.yml runs
// them) used to sit outside the web allow-list.
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
    'apps/web/tests/experience-browser/qualification.pw.ts',
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

for (const file of [
  'apps/mobile-storefront/__tests__/checkout/contact.test.tsx',
  'apps/mobile-storefront/__tests__/helpers/render-with-providers.tsx',
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

test('code files in the browser test folders skip the full suite', () => {
  for (const file of [
    'apps/web/tests/checkout-browser/support/cart-page.ts',
    'apps/web/tests/checkout-browser/harness/app/api/orders/route.test.ts',
    'apps/web/tests/oxygen-cookie-harness/server.ts',
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
