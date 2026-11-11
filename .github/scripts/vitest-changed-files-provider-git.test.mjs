import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createGitFixture } from './resolve-ci-test-plan-git-fixture.test-support.mjs';
import {
  findChangedFilesWithFsReaders,
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
