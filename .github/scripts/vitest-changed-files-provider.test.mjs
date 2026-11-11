import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createGitFixture } from './resolve-ci-test-plan-git-fixture.test-support.mjs';
import provider, {
  findFsReaders,
  listCandidateSources,
  normalizeForNeedles,
  TOO_LARGE,
} from './vitest-changed-files-provider.mjs';

function readersOf(changedFiles, sources) {
  let listed = 0;
  const readers = findFsReaders({
    changedFiles,
    listCandidates: () => {
      listed += 1;
      return Object.keys(sources);
    },
    readText: (file) => sources[file],
  });
  return { listed, readers };
}

test('join arguments, slashes and Windows separators read the same', () => {
  assert.ok(
    normalizeForNeedles("join(root, 'supabase', 'migrations')").includes(
      "'supabase/migrations'"
    )
  );
  assert.ok(
    normalizeForNeedles('resolve(\n  "docs",\n  "superpowers"\n)').includes(
      '"docs/superpowers"'
    )
  );
  assert.ok(
    normalizeForNeedles('docs\\guides\\a.md').includes('docs/guides/a.md')
  );
});

test('a regex-escaped path in a test still names the folder', () => {
  assert.ok(
    normalizeForNeedles(
      '/^supabase\\/migrations\\/(\\d{14})_x[.]sql$/'
    ).includes('supabase/migrations/')
  );

  const { readers } = readersOf(['supabase/migrations/20261111090000_x.sql'], {
    'apps/web/tools/db/verify-sources.ts':
      "import { readdirSync } from 'node:fs';\nconst MIGRATION = /^supabase\\/migrations\\/(\\d{14})_[a-z0-9_]+[.]sql$/;",
    'apps/web/tools/db/unrelated.ts': 'const OTHER = /^docs\\/guides\\/x$/;',
  });

  assert.deepEqual(readers, ['apps/web/tools/db/verify-sources.ts']);
});

test('no source is listed or read when the diff holds no fs-reader file', () => {
  const { listed, readers } = readersOf(
    ['apps/web/src/lib/a.ts', 'apps/web/src/lib/a.test.ts'],
    { 'apps/web/src/b.test.ts': "readFileSync('supabase/migrations')" }
  );

  assert.equal(listed, 0);
  assert.deepEqual(readers, []);
});

test('a test that names the changed file is a reader even when a helper does the reading', () => {
  const { readers } = readersOf(
    ['docs/guides/ad-tracking-screenshot-review.md'],
    {
      'apps/web/src/guide.test.tsx':
        "import { loadGuide } from './load';\nloadGuide('../../docs/guides/ad-tracking-screenshot-review.md');",
      'apps/web/src/other.test.tsx':
        "loadGuide('../../docs/runbooks/other.md');",
    }
  );

  assert.deepEqual(readers, ['apps/web/src/guide.test.tsx']);
});

test('a test that lists the directory of a new migration is a reader', () => {
  const { readers } = readersOf(
    ['supabase/migrations/20261111090000_new.sql'],
    {
      'apps/web/src/migrations.test.ts':
        "readdirSync(join(root, 'supabase', 'migrations'))",
      'apps/web/src/functions.test.ts': "readdirSync('supabase/functions')",
      'apps/web/src/unrelated.test.ts': 'expect(1).toBe(1)',
    }
  );

  assert.deepEqual(readers, ['apps/web/src/migrations.test.ts']);
});

test('a non-test module only counts when it uses fs', () => {
  const { readers } = readersOf(
    ['apps/web/tools/db/replay-registry/2026_x/sql-checks.txt'],
    {
      'apps/web/tools/db/replay-registry.ts':
        "import { readdirSync } from 'node:fs';\nreaddirSync(join(dirname, 'replay-registry'));",
      'apps/web/src/lib/error-message.ts':
        "throw new Error('see apps/web/tools/db/replay-registry/README.md');",
    }
  );

  assert.deepEqual(readers, ['apps/web/tools/db/replay-registry.ts']);
});

test('markdown outside a directory family matches only its own path', () => {
  const { readers } = readersOf(['apps/web/src/lib/x/notes.md'], {
    'apps/web/src/lib/x/notes.test.ts':
      "readFileSync('apps/web/src/lib/x/notes.md')",
    'apps/web/src/lib/y.test.ts': "readFileSync('apps/web/src/lib/y.ts')",
  });

  assert.deepEqual(readers, ['apps/web/src/lib/x/notes.test.ts']);
});

test('unreadable and oversized sources are skipped', () => {
  const { readers } = readersOf(['vercel.json'], {
    'apps/web/src/gone.test.ts': undefined,
    'apps/web/src/routing.test.ts': "readFileSync('../../vercel.json')",
  });

  assert.deepEqual(readers, ['apps/web/src/routing.test.ts']);
});

test('a non-test module counts when it reads files with streams, stat or a glob library', () => {
  const { readers } = readersOf(['docs/guides/a.md'], {
    'apps/web/tools/docs/stream-reader.ts':
      "import { createReadStream } from 'node:fs';\ncreateReadStream('docs/guides/a.md');",
    'apps/web/tools/docs/glob-reader.ts':
      "import { globby } from 'globby';\nawait globby('docs/guides/*.md');",
    'apps/web/tools/docs/stat-reader.ts': "await stat('docs/guides/a.md');",
    'apps/web/tools/docs/label.ts':
      "export const label = 'see docs/guides/a.md for the steps';",
  });

  assert.deepEqual(readers.sort(), [
    'apps/web/tools/docs/glob-reader.ts',
    'apps/web/tools/docs/stat-reader.ts',
    'apps/web/tools/docs/stream-reader.ts',
  ]);
});

test('a helper that only builds the path counts, a module that only names it does not', () => {
  const { readers } = readersOf(['supabase/migrations/20261111090000_x.sql'], {
    'apps/web/src/lib/test-paths.ts':
      "import { join } from 'node:path';\nexport const MIGRATIONS = join(ROOT, 'supabase', 'migrations');",
    'apps/web/src/lib/dirname-paths.ts':
      "export const MIGRATIONS = __dirname + '/../supabase/migrations';",
    'apps/web/src/lib/error-message.ts':
      "throw new Error('apply supabase/migrations first');",
  });

  assert.deepEqual(readers.sort(), [
    'apps/web/src/lib/dirname-paths.ts',
    'apps/web/src/lib/test-paths.ts',
  ]);
});

test('a constants-only helper holding the path as a literal counts, a sentence or a bare word does not', () => {
  const migration = readersOf(['supabase/migrations/20261111090000_x.sql'], {
    'apps/web/src/lib/paths.ts':
      "export const MIGRATIONS = '../../supabase/migrations';",
    'apps/web/src/lib/joined-paths.ts':
      "export const MIGRATIONS = ['supabase', 'migrations'].join('/');",
    'apps/web/src/lib/message.ts':
      "throw new Error('apply supabase/migrations first');",
    'apps/web/src/lib/comment.ts':
      '// the files live in supabase/migrations\nexport const x = 1;',
  }).readers;
  const docs = readersOf(['docs/guides/a.md'], {
    'apps/web/src/lib/kind.ts': "export type Kind = 'docs' | 'code';",
    'apps/web/src/lib/guide-path.ts':
      "export const GUIDE = 'docs/guides/a.md';",
    'apps/web/src/lib/help-text.ts':
      "export const HELP = 'see docs/guides/a.md for details';",
  }).readers;

  assert.deepEqual(migration.sort(), [
    'apps/web/src/lib/joined-paths.ts',
    'apps/web/src/lib/paths.ts',
  ]);
  assert.deepEqual(docs, ['apps/web/src/lib/guide-path.ts']);
});

test('a test file too large to search is assumed to be a reader, a large module is not', () => {
  const { readers } = readersOf(['supabase/migrations/20261111090000_x.sql'], {
    'apps/web/src/lib/huge-generated.test.ts': TOO_LARGE,
    'apps/web/src/types/huge-generated-types.ts': TOO_LARGE,
  });

  assert.deepEqual(readers, ['apps/web/src/lib/huge-generated.test.ts']);
});

test('readers of several changed files are combined once', () => {
  const { readers } = readersOf(['vercel.json', 'docs/guides/a.md'], {
    'apps/web/src/both.test.ts': "'vercel.json' 'docs/guides/a.md'",
    'apps/web/src/vercel.test.ts': "'vercel.json'",
  });

  assert.deepEqual(readers.sort(), [
    'apps/web/src/both.test.ts',
    'apps/web/src/vercel.test.ts',
  ]);
});

test('exports the shape Vitest requires of a vcsProvider module', async () => {
  assert.equal(typeof provider.findChangedFiles, 'function');
  const repo = createGitFixture();
  try {
    repo.write('apps/web/src/a.ts', 'export const a = 1;\n');
    const base = repo.commit('base');
    assert.deepEqual(
      await provider.findChangedFiles({ root: repo.root, changedSince: base }),
      []
    );
  } finally {
    repo.cleanup();
  }
});

// The reader search must keep finding the tests this repository relies on. If a
// test below is renamed, update the path: the point is that these readers stay
// selectable, because `vitest --changed` cannot see them through imports.
test('finds the known readers of real migrations, registry files, workflows and the edge inventory', () => {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const candidates = listCandidateSources(top);
  const cache = new Map();
  const readText = (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(resolve(top, file), 'utf8'));
      } catch {
        cache.set(file, undefined);
      }
    }
    return cache.get(file);
  };
  const readersOfReal = (file) =>
    findFsReaders({
      changedFiles: [file],
      listCandidates: () => candidates,
      readText,
    });

  const migration = readersOfReal(
    'supabase/migrations/20261111090000_new_migration_for_the_reader_search.sql'
  );
  assert.ok(
    migration.length > 100,
    `expected many migration readers, got ${migration.length}`
  );
  assert.ok(
    migration.length < 1500,
    `migration readers exploded to ${migration.length}`
  );
  assert.ok(
    migration.includes(
      'apps/web/src/lib/agentic/order-private-schema-usage-migration.test.ts'
    )
  );

  const registry = readersOfReal(
    'apps/web/tools/db/replay-registry/20261111090000_new/sql-checks.txt'
  );
  assert.ok(registry.includes('apps/web/tools/db/replay-registry.ts'));
  assert.ok(registry.includes('apps/web/tools/db/replay-registry.test.ts'));

  const inventory = readersOfReal(
    'docs/superpowers/evidence/storefront-edge/task-1a-inventory.json'
  );
  assert.ok(
    inventory.includes(
      'apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts'
    )
  );

  const workflow = readersOfReal('.github/workflows/deploy.yml');
  assert.ok(
    workflow.includes(
      'apps/web/src/lib/storefront-order-rpc-context-migration.test.ts'
    )
  );

  // No web test reads the Jules notes; only this planner's own fixtures name them.
  const notes = readersOfReal('.jules/prompts/atlas.md');
  assert.deepEqual(
    notes.filter((file) => file.startsWith('apps/web/')),
    []
  );
});
