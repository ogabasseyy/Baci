import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRawConfig } from './money-pr-assurance.test-support.mjs';
import {
  classifyChangedFiles,
  globToRegExp,
  matchesAny,
  parseAssuranceConfig,
} from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());

test('glob patterns follow path segments', () => {
  assert.ok(
    globToRegExp('supabase/migrations/*wallet*').test(
      'supabase/migrations/20261101_wallet_state.sql'
    )
  );
  assert.ok(
    !globToRegExp('supabase/migrations/*wallet*').test(
      'supabase/migrations/tests/wallet_state.sql'
    )
  );
  assert.ok(
    globToRegExp('apps/web/src/lib/piggyvest/**').test(
      'apps/web/src/lib/piggyvest/a/b/c.ts'
    )
  );
  assert.ok(
    !globToRegExp('apps/web/src/lib/piggyvest/**').test(
      'apps/web/src/lib/piggyvest-other.ts'
    )
  );
  assert.ok(
    globToRegExp('apps/web/tools/piggyvest-*/**').test(
      'apps/web/tools/piggyvest-staging/run.ts'
    )
  );
  assert.ok(globToRegExp('docs/**/x.md').test('docs/x.md'));
  assert.ok(globToRegExp('docs/**/x.md').test('docs/a/b/x.md'));
  assert.ok(globToRegExp('a?c.md').test('abc.md'));
  assert.ok(!globToRegExp('a?c.md').test('a/c.md'));
  // Regex metacharacters in a pattern are literal.
  assert.ok(
    globToRegExp('.github/scripts/money-pr-assurance*').test(
      '.github/scripts/money-pr-assurance.mjs'
    )
  );
  assert.ok(
    !globToRegExp('.github/scripts/money-pr-assurance*').test(
      'xgithub/scripts/money-pr-assurance.mjs'
    )
  );
});

test('matching is case-insensitive so renamed casing cannot dodge the gate', () => {
  assert.ok(
    matchesAny('apps/web/src/lib/PiggyVest/route.ts', [
      'apps/web/src/lib/piggyvest/**',
    ])
  );
  assert.ok(
    !matchesAny('apps/web/src/lib/orders/route.ts', [
      'apps/web/src/lib/piggyvest/**',
    ])
  );
});

test('a PR touching only unrelated files is not a money-path PR', () => {
  const result = classifyChangedFiles(
    [
      {
        filename: 'apps/web/src/components/storefront/hero.tsx',
        status: 'modified',
      },
      {
        filename: 'docs/piggyvest-change-summaries/TEMPLATE.md',
        status: 'modified',
      },
    ],
    config
  );
  assert.equal(result.isMoneyPath, false);
  assert.deepEqual(result.moneyFiles, []);
});

test('PiggyVest server code, wallet migrations and governance files are money paths', () => {
  const result = classifyChangedFiles(
    [
      {
        filename: 'apps/web/src/lib/piggyvest/transfer.ts',
        status: 'modified',
      },
      {
        filename: 'supabase/migrations/20261101000000_wallet_backing_state.sql',
        status: 'added',
      },
      {
        filename: '.github/scripts/money-pr-assurance-config.mjs',
        status: 'modified',
      },
      { filename: 'apps/web/src/app/page.tsx', status: 'modified' },
    ],
    config
  );
  assert.equal(result.isMoneyPath, true);
  assert.deepEqual(result.moneyFiles, [
    'apps/web/src/lib/piggyvest/transfer.ts',
    'supabase/migrations/20261101000000_wallet_backing_state.sql',
    '.github/scripts/money-pr-assurance-config.mjs',
  ]);
  assert.deepEqual(result.governanceFiles, [
    '.github/scripts/money-pr-assurance-config.mjs',
  ]);
});

test('moving a money file out of a money path still counts as a money-path change', () => {
  const result = classifyChangedFiles(
    [
      {
        filename: 'apps/web/src/lib/other/transfer.ts',
        previousFilename: 'apps/web/src/lib/piggyvest/transfer.ts',
        status: 'renamed',
      },
    ],
    config
  );
  assert.equal(result.isMoneyPath, true);
  assert.deepEqual(result.moneyFiles, [
    'apps/web/src/lib/piggyvest/transfer.ts',
  ]);
});

test('the committed configuration parses and names every required part', () => {
  assert.equal(config.statusContext, 'money-pr-assurance');
  assert.deepEqual(config.reviewers.groups, [['codex'], ['claude', 'gemini']]);
  assert.equal(config.summary.maxWords, 450);
  assert.equal(config.summary.headings.length, 5);
  assert.deepEqual(config.ownerSignoff.logins, ['ogabasseyy']);
  assert.ok(
    config.requiredChecks.some(
      ({ name }) => name === 'Quality Gate - DB Replay'
    )
  );
});

test('a malformed configuration is rejected instead of silently passing PRs', () => {
  const raw = loadRawConfig();
  const cases = [
    [{ ...raw, version: 2 }, /version/],
    [{ ...raw, moneyPaths: [] }, /moneyPaths/],
    [{ ...raw, moneyPaths: ['ok/**', 7] }, /moneyPaths/],
    [{ ...raw, statusContext: '' }, /statusContext/],
    [{ ...raw, summary: { ...raw.summary, maxWords: 0 } }, /maxWords/],
    [{ ...raw, summary: { ...raw.summary, headings: [] } }, /headings/],
    [
      {
        ...raw,
        reviewers: { ...raw.reviewers, groups: [['codex'], ['nobody']] },
      },
      /unknown reviewer family/,
    ],
    [
      { ...raw, reviewers: { ...raw.reviewers, groups: [['codex']] } },
      /at least two/,
    ],
    [
      {
        ...raw,
        reviewers: { ...raw.reviewers, groups: [['codex'], ['codex']] },
      },
      /different model families/,
    ],
    [
      {
        ...raw,
        reviewers: {
          ...raw.reviewers,
          families: {
            ...raw.reviewers.families,
            claude: { kind: 'magic', logins: ['claude[bot]'] },
          },
        },
      },
      /kind/,
    ],
    [
      { ...raw, ownerSignoff: { ...raw.ownerSignoff, logins: [] } },
      /ownerSignoff/,
    ],
    [{ ...raw, requiredChecks: [{ name: '' }] }, /requiredChecks/],
    [null, /object/],
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(() => parseAssuranceConfig(candidate), pattern);
  }
});
