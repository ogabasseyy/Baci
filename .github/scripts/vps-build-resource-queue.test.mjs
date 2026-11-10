import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const workflow = name => YAML.parse(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));
const deployment = workflow('deploy.yml');
const android = ['android-release.yml', 'android-storefront-release.yml'].map(workflow);
const shared = { group: 'production-prebuilt-deploy', 'cancel-in-progress': false };

for (const [index, release] of android.entries()) {
  test(`Android release ${index} refuses stale main builds before resource-heavy setup`, () => {
    const steps = release.jobs['build-and-deploy'].steps;
    if (!release.on.push.branches) {
      // Gated release (tag/dispatch only): no push-to-main build to refuse, the release gate runs first.
      assert.equal(steps.findIndex(step => step.name === 'Refuse superseded main release before build'), -1);
      assert.equal(steps[1].name, 'Refuse release sources that are not on main');
      return;
    }
    const guardIndex = steps.findIndex(step => step.name === 'Refuse superseded main release before build');
    assert.equal(guardIndex, 1);
    const guard = steps[guardIndex];
    assert.equal(guard.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
    assert.equal(guard.run, 'bash .github/scripts/refuse-superseded-android-build.sh');
    assert.ok(steps.some(step => step.name === 'Guard Google Play upload against stale main builds'));
    const directory = mkdtempSync(join(tmpdir(), 'baci-early-main-'));
    try {
      const git = join(directory, 'git');
      writeFileSync(git, '#!/bin/sh\n[ "$*" = "ls-remote origin refs/heads/main" ] || exit 91\n[ "$TEST_GIT_FAILURE" != "1" ] || exit 92\nprintf "%s\\trefs/heads/main\\n" "$TEST_MAIN_SHA"\n');
      chmodSync(git, 0o755);
      const sha = 'a'.repeat(40);
      for (const [main, failure, expected] of [[sha, '0', 0], ['b'.repeat(40), '0', 1], ['', '0', 1], [sha, '1', 1]]) {
        const result = spawnSync('/bin/bash', [fileURLToPath(new URL('./refuse-superseded-android-build.sh', import.meta.url))], {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${directory}:/usr/bin:/bin`, GITHUB_SHA: sha, TEST_MAIN_SHA: main, TEST_GIT_FAILURE: failure },
        });
        if (expected === 0) assert.equal(result.status, 0, result.stderr);
        else assert.notEqual(result.status, 0);
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

test('production and both Android builds share a non-cancelling VPS build group', () => {
  assert.deepEqual(deployment.jobs['deploy-production'].concurrency, shared);
  for (const release of android) {
    assert.deepEqual(release.jobs['build-and-deploy'].concurrency, shared);
    assert.equal(release.jobs['build-and-deploy']['runs-on'], 'baci-android');
  }
  assert.equal(deployment.jobs['deploy-production']['runs-on'], 'baci-deploy');
});

test('no workflow uses concurrency.queue, which the pinned actionlint and CWV authority reject', () => {
  for (const release of [deployment, ...android]) {
    assert.equal(release.concurrency.queue, undefined);
    assert.equal(release.concurrency['cancel-in-progress'], false);
    assert.notEqual(release.concurrency.group, shared.group);
    for (const job of Object.values(release.jobs)) assert.equal(job.concurrency?.queue, undefined);
  }
  const lintConfig = readFileSync(new URL('../actionlint.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(lintConfig, /queue|ignore/);
});

test('the shared-group validator runs before actionlint and its triggers are covered', () => {
  const lintWorkflow = workflow('actionlint.yml');
  const steps = lintWorkflow.jobs.actionlint.steps;
  const validatorIndex = steps.findIndex(step => step.run === 'node --test .github/scripts/vps-build-resource-queue.test.mjs .github/scripts/production-typecheck-scope.test.mjs');
  const lintIndex = steps.findIndex(step => step.name === 'Run actionlint');
  assert.ok(validatorIndex >= 0 && validatorIndex < lintIndex);
  assert.equal(steps[validatorIndex]['continue-on-error'], undefined);
  for (const event of ['push', 'pull_request']) {
    assert.ok(lintWorkflow.on[event].paths.includes('.github/scripts/vps-build-resource-queue.test.mjs'));
  }
});
