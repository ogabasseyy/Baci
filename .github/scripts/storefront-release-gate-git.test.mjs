// Behavioural tests of the storefront release gate's git checks, run against
// throwaway repositories: the OTA export guard, the store release source
// guard, and the baseline lookup behind the server-off rule.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATE_MARKER,
  gitRepository,
  OTA_GUARD_STEP,
  OTA_WORKFLOW,
  RELEASE_GUARD_STEP,
  RELEASE_WORKFLOWS,
} from './storefront-release-gate.mjs';
import { readJob, readStep } from './storefront-release-gate-workflows.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const real = gitRepository(ROOT);
const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Gate Test',
  GIT_AUTHOR_EMAIL: 'gate@example.test',
  GIT_AUTHOR_DATE: '2026-10-31T00:00:00Z',
  GIT_COMMITTER_NAME: 'Gate Test',
  GIT_COMMITTER_EMAIL: 'gate@example.test',
  GIT_COMMITTER_DATE: '2026-10-31T00:00:00Z',
};

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
}

function commitFile(dir, file, content) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', `add ${file}`);
  return git(dir, 'rev-parse', 'HEAD');
}

// A repository whose main has two commits, plus a feature commit that never
// reached main; refs/remotes/origin/main mirrors main, as in a CI checkout.
function withRepository(callback) {
  const dir = mkdtempSync(path.join(tmpdir(), 'storefront-release-gate-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    const first = commitFile(dir, 'README.md', 'before the gate\n');
    const second = commitFile(dir, 'apps/mobile-storefront/app.tsx', 'export {};\n');
    git(dir, 'checkout', '-q', '-b', 'feature');
    const feature = commitFile(dir, 'apps/mobile-storefront/components/wallet/SpendSheet.tsx', 'export {};\n');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
    mkdirSync(path.join(dir, 'apps/mobile-storefront/components'), { recursive: true });
    callback({ dir, first, second, feature });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runScript(script, cwd, env) {
  return spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...env } });
}

test('the OTA export refuses a source that carries the gate marker, from any working directory', () => {
  const guard = readStep(readJob(real.readFile(OTA_WORKFLOW), 'export'), OTA_GUARD_STEP)?.run;
  assert.ok(guard, 'the OTA guard step must have a run script');
  withRepository(({ dir, second }) => {
    const marked = commitFile(dir, GATE_MARKER, '{}\n');
    for (const cwd of [dir, path.join(dir, 'apps/mobile-storefront/components')]) {
      const run = (sourceSha) => runScript(guard, cwd, { SOURCE_SHA: sourceSha });
      assert.equal(run(second).status, 0, run(second).stderr);
      const refused = run(marked);
      assert.equal(refused.status, 1, cwd);
      assert.match(refused.stderr, /storefront release gate/);
      assert.match(refused.stderr, /docs\/runbooks\/storefront-release-gate\.md/);
      assert.notEqual(run('e'.repeat(40)).status, 0, 'an unknown commit must fail closed');
      assert.notEqual(run('main').status, 0, 'a branch name is not a reviewed source SHA');
    }
  });
});

test('each store release and the manual submit refuse a commit that is not on main', () => {
  for (const [workflow, { job }] of [...RELEASE_WORKFLOWS, ['.github/workflows/ios-storefront-submit.yml', { job: 'submit' }]]) {
    const guard = readStep(readJob(real.readFile(workflow), job), RELEASE_GUARD_STEP)?.run;
    assert.ok(guard, `${workflow} must have a release source guard script`);
    withRepository(({ dir, first, second, feature }) => {
      for (const cwd of [dir, path.join(dir, 'apps/mobile-storefront')]) {
        const run = (releaseSha) => runScript(guard, cwd, { RELEASE_SHA: releaseSha });
        assert.equal(run(second).status, 0, run(second).stderr);
        assert.equal(run(first).status, 0, 'an older main commit is still a reviewed main commit');
        const refused = run(feature);
        assert.equal(refused.status, 1, `${workflow} must refuse an unmerged commit`);
        assert.match(refused.stderr, /not on main/);
        assert.match(refused.stderr, /docs\/runbooks\/storefront-release-gate\.md/);
        assert.equal(run('e'.repeat(40)).status, 1, 'an unknown commit must fail closed');
      }
      git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
      assert.equal(runScript(guard, dir, { RELEASE_SHA: second }).status, 1, 'a checkout without main must fail closed');
    });
  }
});

test('the baseline must be a main commit that HEAD contains', () => {
  withRepository(({ dir, first, second, feature }) => {
    // HEAD is a pull request merge commit: main plus the feature commit.
    git(dir, 'checkout', '-q', '-b', 'pull-merge', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
    const repository = gitRepository(dir);
    assert.deepEqual(repository.listBaseline(second, 'apps/mobile-storefront'), ['apps/mobile-storefront/app.tsx']);
    assert.deepEqual(repository.listBaseline(first, 'apps/mobile-storefront'), []);
    assert.equal(repository.listBaseline(feature, 'apps/mobile-storefront'), undefined, 'a pull request commit is not a baseline');
    assert.equal(repository.listBaseline('e'.repeat(40), 'apps/mobile-storefront'), undefined);
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(repository.listBaseline(second, 'apps/mobile-storefront'), undefined, 'no main ref fails closed');
  });
});
