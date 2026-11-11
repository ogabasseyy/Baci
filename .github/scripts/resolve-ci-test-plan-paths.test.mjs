import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  FS_READER_FAMILIES,
  fsReaderFamilyOf,
  isFsReaderFile,
  readerNeedlesFor,
} from './resolve-ci-test-plan-paths.mjs';

const FAMILY_EXAMPLES = {
  'supabase/migrations/20261111090000_x.sql': 'supabase',
  'supabase/config.toml': 'supabase',
  'apps/web/tools/db/replay-registry/2026_x/sql-checks.txt': 'replay-registry',
  'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json': 'docs',
  '.github/workflows/pilot-codec-compatibility.yml': 'github-metadata',
  '.github/copilot-instructions.md': 'github-metadata',
  'vps-workers/deploy.sh': 'vps-workers',
  '.jules/atlas.md': 'agent-notes',
  '.ruler/01-critical-rules.md': 'agent-notes',
  '.coderabbit.yaml': 'agent-notes',
  'AGENTS.md': 'markdown',
  'apps/web/src/lib/x/notes.md': 'markdown',
  'vercel.json': 'vercel',
};

test('each fs-reader family claims its files and leaves code alone', () => {
  for (const [file, family] of Object.entries(FAMILY_EXAMPLES)) {
    assert.equal(fsReaderFamilyOf(file)?.id, family, file);
  }

  for (const code of [
    'apps/web/src/lib/a.ts',
    'apps/web/tools/cost/a.ts',
    'apps/mobile-admin/app/index.tsx',
    'packages/shared/src/index.ts',
    'tools/staging/x.mjs',
    'scripts/backfill.ts',
    '.github/scripts/run-ci-web-shard.sh',
    '.github/actions/pnpm-install-cached/action.yml',
    '.github/filters/ci.yml',
    'pnpm-workspace.yaml',
  ]) {
    assert.equal(isFsReaderFile(code), false, code);
  }
});

test('the reader search covers the file, its folders down to the family floor, and bare names', () => {
  assert.deepEqual(
    readerNeedlesFor('supabase/migrations/20261111090000_x.sql').sort(),
    ['supabase/migrations', 'supabase/migrations/20261111090000_x.sql']
  );
  assert.deepEqual(readerNeedlesFor('supabase/tests/deep/run.sql').sort(), [
    'supabase/tests',
    'supabase/tests/deep',
    'supabase/tests/deep/run.sql',
  ]);
  for (const name of ['vercel.json', 'README.md']) {
    assert.deepEqual(
      new Set(readerNeedlesFor(name)),
      new Set([`'${name}`, `"${name}`, `/${name}`, `\`${name}`])
    );
  }

  const registry = readerNeedlesFor(
    'apps/web/tools/db/replay-registry/2026_x/sql-checks.txt'
  );
  for (const needle of [
    'apps/web/tools/db/replay-registry/2026_x/sql-checks.txt',
    'apps/web/tools/db/replay-registry/2026_x',
    'apps/web/tools/db/replay-registry',
    // Tests resolve paths from the app root (`process.cwd()` is apps/web).
    'tools/db/replay-registry/2026_x/sql-checks.txt',
    'tools/db/replay-registry',
    'replay-registry',
  ]) {
    assert.ok(registry.includes(needle), needle);
  }

  const docs = readerNeedlesFor(
    'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
  );
  for (const needle of [
    'docs/superpowers/evidence/storefront-edge',
    'docs/superpowers/evidence',
    'docs/superpowers',
    "'docs'",
  ]) {
    assert.ok(docs.includes(needle), needle);
  }
});

// A generic file name must not select tests that only contain it inside another
// name (`wrangler.config.toml`) or prose: a path separator or a quote has to sit
// right before it.
test('a bare file name needs a separator or quote before it', () => {
  const needles = readerNeedlesFor('supabase/config.toml');

  assert.ok(needles.includes('supabase/config.toml'));
  for (const needle of [
    "'config.toml",
    '"config.toml',
    '/config.toml',
    '`config.toml',
  ]) {
    assert.ok(needles.includes(needle), needle);
  }
  assert.equal(needles.includes('config.toml'), false);
  assert.equal(
    readerNeedlesFor('apps/web/README.md').includes('README.md'),
    false
  );
  assert.ok(readerNeedlesFor('apps/web/README.md').includes('/README.md'));
});

test('markdown outside a directory family is matched by its own path only', () => {
  assert.deepEqual(readerNeedlesFor('apps/web/src/lib/x/notes.md'), [
    'apps/web/src/lib/x/notes.md',
    'src/lib/x/notes.md',
  ]);
  assert.deepEqual(readerNeedlesFor('apps/web/src/lib/a.ts'), []);
  // Playwright specs are no reader family: the browser workflow validates them.
  assert.equal(
    isFsReaderFile('apps/web/tests/checkout-browser/contact.pw.ts'),
    false
  );
});

test('no search string is broad enough to select a large part of the suite', () => {
  const tracked = execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter(isFsReaderFile);
  const needles = new Set(tracked.flatMap(readerNeedlesFor));
  const tooBroad = [
    'apps',
    'apps/web',
    'web',
    'src',
    'docs',
    'supabase',
    'packages',
    'tools',
    'scripts',
    '.github',
    'vps-workers',
    '.github/scripts',
    '.github/actions',
  ];

  assert.ok(tracked.length > 100, 'expected fs-reader files in the repository');
  for (const broad of tooBroad) {
    assert.equal(
      needles.has(broad),
      false,
      `${broad} would match too many tests`
    );
  }
  for (const needle of needles) {
    assert.ok(needle.length >= 4, `"${needle}" is too short to search for`);
  }
});

// A new family without an example (and so without a test of what it claims) must
// fail here instead of passing unnoticed.
test('every fs-reader family has an example in the table above', () => {
  const covered = new Set(Object.values(FAMILY_EXAMPLES));

  for (const { id, floor, matches } of FS_READER_FAMILIES) {
    assert.equal(typeof matches, 'function', id);
    assert.ok(Number.isFinite(floor) || floor === Number.POSITIVE_INFINITY, id);
    assert.ok(covered.has(id), `${id} needs an example in FAMILY_EXAMPLES`);
  }
});
