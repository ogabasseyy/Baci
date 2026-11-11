// bugfix: the planner's `git diff` used `--diff-filter=ACMRTUXB`, which drops
// deleted files. A pull request that deleted a file the full suite depends on
// (a shared package file, a CI action) while editing web source looked like a
// web-only change and skipped the suite. Renames hid the old path the same way.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedFilesDiffArgs,
  getChangedFiles,
  resolveCiTestPlan,
} from './resolve-ci-test-plan.mjs';
import { createGitFixture } from './resolve-ci-test-plan-git-fixture.test-support.mjs';

function planFor(changedFiles) {
  return resolveCiTestPlan({
    baseRef: 'main',
    changedFiles,
    eventName: 'pull_request',
  });
}

test('bugfix: the diff arguments keep deleted files and both sides of a rename', () => {
  const args = changedFilesDiffArgs('origin/main', 'HEAD');

  assert.deepEqual(args, [
    'diff',
    '--name-only',
    '--no-renames',
    'origin/main...HEAD',
  ]);
  assert.ok(!args.some((arg) => arg.startsWith('--diff-filter')));
});

test('bugfix: deleted, renamed, modified and added files all reach the planner', () => {
  const repo = createGitFixture();
  try {
    repo.write('packages/shared/src/removed.ts', 'export const a = 1;\n');
    repo.write('apps/web/src/moved.ts', 'export const b = 1;\n');
    repo.write('apps/web/src/edited.ts', 'export const c = 1;\n');
    repo.commit('base');
    repo.branch('feature');

    repo.remove('packages/shared/src/removed.ts');
    repo.remove('apps/web/src/moved.ts');
    repo.write('apps/web/src/moved-again.ts', 'export const b = 1;\n');
    repo.write('apps/web/src/edited.ts', 'export const c = 2;\n');
    repo.write('apps/web/src/added.ts', 'export const d = 1;\n');
    repo.commit('feature');

    const files = getChangedFiles('main', 'HEAD', { cwd: repo.root }).sort();

    assert.deepEqual(files, [
      'apps/web/src/added.ts',
      'apps/web/src/edited.ts',
      'apps/web/src/moved-again.ts',
      'apps/web/src/moved.ts',
      'packages/shared/src/removed.ts',
    ]);
  } finally {
    repo.cleanup();
  }
});

test('bugfix: deleting a shared package file while editing web source keeps the full suite', () => {
  const repo = createGitFixture();
  try {
    repo.write('packages/shared/src/helper.ts', 'export const helper = 1;\n');
    repo.write('apps/web/src/page.ts', 'export const page = 1;\n');
    repo.commit('base');
    repo.branch('feature');
    repo.remove('packages/shared/src/helper.ts');
    repo.write('apps/web/src/page.ts', 'export const page = 2;\n');
    repo.commit('feature');

    const withDeletions = getChangedFiles('main', 'HEAD', { cwd: repo.root });
    const withoutDeletions = withDeletions.filter(
      (file) => file !== 'packages/shared/src/helper.ts'
    );

    // The old filter produced `withoutDeletions`: web source only, which is
    // targeted and would have skipped the suite the deleted file belongs to.
    assert.equal(planFor(withoutDeletions).mode, 'targeted-web-vitest');
    assert.equal(planFor(withDeletions).mode, 'full-affected');
  } finally {
    repo.cleanup();
  }
});

test('bugfix: moving a file out of a shared package keeps the full suite', () => {
  const repo = createGitFixture();
  try {
    repo.write('packages/shared/src/moved.ts', 'export const moved = 1;\n');
    repo.commit('base');
    repo.branch('feature');
    repo.remove('packages/shared/src/moved.ts');
    repo.write('apps/web/src/moved.ts', 'export const moved = 1;\n');
    repo.commit('feature');

    const files = getChangedFiles('main', 'HEAD', { cwd: repo.root });

    assert.deepEqual(files.sort(), [
      'apps/web/src/moved.ts',
      'packages/shared/src/moved.ts',
    ]);
    assert.equal(planFor(files).mode, 'full-affected');
  } finally {
    repo.cleanup();
  }
});

test('a pull request that only deletes documentation is not forced onto the full suite', () => {
  const repo = createGitFixture();
  try {
    repo.write('docs/audits/old-report.md', '# old\n');
    repo.write('apps/web/src/page.ts', 'export const page = 1;\n');
    repo.commit('base');
    repo.branch('feature');
    repo.remove('docs/audits/old-report.md');
    repo.write('apps/web/src/page.ts', 'export const page = 2;\n');
    repo.commit('feature');

    const files = getChangedFiles('main', 'HEAD', { cwd: repo.root });

    assert.deepEqual(files.sort(), [
      'apps/web/src/page.ts',
      'docs/audits/old-report.md',
    ]);
    assert.equal(planFor(files).mode, 'targeted-web-vitest');
  } finally {
    repo.cleanup();
  }
});

test('an unreadable base ref yields no files so the planner keeps the full suite', () => {
  const repo = createGitFixture();
  try {
    repo.write('apps/web/src/page.ts', 'export const page = 1;\n');
    repo.commit('base');

    const files = getChangedFiles('does-not-exist', 'HEAD', { cwd: repo.root });

    assert.deepEqual(files, []);
    assert.equal(planFor(files).mode, 'full-affected');
  } finally {
    repo.cleanup();
  }
});
