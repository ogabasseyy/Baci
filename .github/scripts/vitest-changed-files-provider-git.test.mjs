import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { mock } from 'node:test';
import { createGitFixture } from './resolve-ci-test-plan-git-fixture.test-support.mjs';
import provider, {
  findChangedFilesWithFsReaders,
  findFsReaders,
  listCandidateSources,
  listGitChangedFiles,
} from './vitest-changed-files-provider.mjs';

test('lists committed, staged and unstaged changes and keeps both sides of a rename', () => {
  const repo = createGitFixture();
  try {
    repo.write('docs/old.md', '# old\n');
    repo.write('apps/web/src/kept.ts', 'export const kept = 1;\n');
    repo.write('apps/web/src/staged.ts', 'export const staged = 1;\n');
    const base = repo.commit('base');
    repo.branch('feature');
    repo.remove('docs/old.md');
    repo.write('docs/new.md', '# old\n');
    repo.commit('rename');
    repo.write('apps/web/src/staged.ts', 'export const staged = 2;\n');
    execFileSync('git', ['add', 'apps/web/src/staged.ts'], { cwd: repo.root });
    repo.write('apps/web/src/untracked.ts', 'export const u = 1;\n');

    const { files } = listGitChangedFiles({
      root: repo.root,
      changedSince: base,
    });
    assert.deepEqual(files.sort(), [
      'apps/web/src/staged.ts',
      'apps/web/src/untracked.ts',
      'docs/new.md',
      'docs/old.md',
    ]);

    const uncommitted = listGitChangedFiles({
      root: repo.root,
      changedSince: true,
    });
    assert.deepEqual(uncommitted.files.sort(), [
      'apps/web/src/staged.ts',
      'apps/web/src/untracked.ts',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('adds the tests that read a new migration, from the app root of a monorepo', () => {
  const repo = createGitFixture();
  try {
    repo.write('supabase/migrations/001_init.sql', 'select 1;\n');
    repo.write(
      'apps/web/src/migrations.test.ts',
      "readdirSync(join(process.cwd(), '..', '..', 'supabase', 'migrations'));\n"
    );
    repo.write('apps/web/src/unrelated.test.ts', 'expect(1).toBe(1);\n');
    const base = repo.commit('base');
    repo.branch('feature');
    repo.write('supabase/migrations/002_next.sql', 'select 2;\n');
    repo.commit('migration');

    const result = findChangedFilesWithFsReaders({
      root: join(repo.root, 'apps/web'),
      changedSince: base,
    });

    // macOS reports temp directories through a symlink; compare real paths.
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repo.root,
      encoding: 'utf8',
    }).trim();
    assert.deepEqual(result.sort(), [
      resolve(top, 'apps/web/src/migrations.test.ts'),
      resolve(top, 'supabase/migrations/002_next.sql'),
    ]);
  } finally {
    repo.cleanup();
  }
});

test('a deleted migration still selects the tests that read the migrations folder', () => {
  const repo = createGitFixture();
  try {
    repo.write('supabase/migrations/001_init.sql', 'select 1;\n');
    repo.write(
      'apps/web/src/migrations.test.ts',
      "readdirSync('supabase/migrations');\n"
    );
    const base = repo.commit('base');
    repo.branch('feature');
    repo.remove('supabase/migrations/001_init.sql');
    repo.commit('delete');

    const result = findChangedFilesWithFsReaders({
      root: repo.root,
      changedSince: base,
    });

    assert.ok(
      result.some((file) => file.endsWith('apps/web/src/migrations.test.ts'))
    );
  } finally {
    repo.cleanup();
  }
});

test('a plain source change returns exactly the git changes', () => {
  const repo = createGitFixture();
  try {
    repo.write('apps/web/src/a.ts', 'export const a = 1;\n');
    repo.write(
      'apps/web/src/b.test.ts',
      "readFileSync('supabase/migrations/001.sql');\n"
    );
    const base = repo.commit('base');
    repo.branch('feature');
    repo.write('apps/web/src/a.ts', 'export const a = 2;\n');
    repo.commit('change');

    const result = findChangedFilesWithFsReaders({
      root: repo.root,
      changedSince: base,
    });

    assert.equal(result.length, 1);
    assert.ok(result[0].endsWith('apps/web/src/a.ts'));
  } finally {
    repo.cleanup();
  }
});

test('a module too large to search is skipped and named in the log, a test that large is selected', () => {
  const repo = createGitFixture();
  const log = mock.method(console, 'error', () => undefined);
  try {
    const padding = `// ${'x'.repeat(1_600_000)}\n`;
    repo.write('apps/web/src/types/generated.ts', padding);
    repo.write('apps/web/src/huge.test.ts', padding);
    repo.write('supabase/migrations/001_init.sql', 'select 1;\n');
    const base = repo.commit('base');
    repo.branch('feature');
    repo.write('supabase/migrations/002_next.sql', 'select 2;\n');
    repo.commit('migration');

    const result = findChangedFilesWithFsReaders({
      root: repo.root,
      changedSince: base,
    });

    assert.ok(
      result.some((file) => file.endsWith('apps/web/src/huge.test.ts'))
    );
    assert.ok(
      !result.some((file) => file.endsWith('apps/web/src/types/generated.ts'))
    );
    const messages = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      messages.some(
        (message) =>
          message.includes(
            '1 module(s) over 1500000 bytes were not searched'
          ) && message.includes('apps/web/src/types/generated.ts')
      ),
      messages.join('\n')
    );
  } finally {
    log.mock.restore();
    repo.cleanup();
  }
});

// An empty answer would tell Vitest that nothing changed and select no tests, so
// a git failure must stop the run with a clear message instead.
test('an unreadable base ref stops the run instead of selecting nothing', async () => {
  const repo = createGitFixture();
  try {
    repo.write('apps/web/src/a.ts', 'export const a = 1;\n');
    repo.commit('base');

    assert.throws(
      () =>
        listGitChangedFiles({ root: repo.root, changedSince: 'no-such-ref' }),
      /changed-files provider: git diff .*no-such-ref.*failed/
    );
    await assert.rejects(
      provider.findChangedFiles({
        root: repo.root,
        changedSince: 'no-such-ref',
      }),
      /changed-files provider: git diff/
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
