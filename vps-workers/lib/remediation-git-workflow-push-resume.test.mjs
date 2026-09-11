import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { remediationGitWorkflowTestFixtures } from './remediation-git-workflow.test-helpers.mjs';

const testContainerIdentity = { gid: 1001, uid: 1001 };
const { candidate, makeRunner } = remediationGitWorkflowTestFixtures;

describe('remediation committed-branch retry', () => {
  it('resumes push and PR creation without rerunning Codex after a push failure', (t) => {
    const worktreeRoot = mkdtempSync(
      join(tmpdir(), 'baci-push-resume-worktrees-')
    );
    t.after(() => rmSync(worktreeRoot, { force: true, recursive: true }));
    const { calls, runner: baseRunner } = makeRunner();
    let codexAttempts = 0;
    let pushAttempts = 0;
    let imageChecks = 0;
    let firstPushFailed = false;
    let retainedWorktree;
    const runner = (command, args, options) => {
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        retainedWorktree = {
          branch: args[args.indexOf('-b') + 1],
          directory: args[2],
        };
      }
      if (command === 'git' && args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: retainedWorktree
            ? `worktree ${retainedWorktree.directory}\nHEAD deadbeef\nbranch refs/heads/${retainedWorktree.branch}\n`
            : 'worktree /repo\nHEAD deadbeef\nbranch refs/heads/main\n',
          stderr: '',
        };
      }
      if (
        command === 'git' &&
        args.join(' ') === 'rev-list --count origin/main..HEAD'
      ) {
        return { status: 0, stdout: '1\n', stderr: '' };
      }
      if (command === 'git' && args.includes('push') && pushAttempts++ === 0) {
        firstPushFailed = true;
        return { status: 1, stdout: '', stderr: 'push network unavailable' };
      }
      if (command === 'docker' && args[0] === 'image') {
        imageChecks += 1;
        if (firstPushFailed) {
          return { status: 1, stdout: '', stderr: 'image unavailable' };
        }
      }
      if (
        command === 'codex' ||
        (command === 'docker' &&
          (args.includes('--dangerously-bypass-approvals-and-sandbox') ||
            (args.includes('--sandbox') && args.includes('read-only'))))
      ) {
        codexAttempts++;
      }
      return baseRunner(command, args, options);
    };
    const env = {
      BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
      BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
      BACI_REMEDIATION_RUN_ID: 'push-retry',
      BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
      BACI_REPO_DIR: '/repo',
      BACI_REMEDIATION_WORKTREE_ROOT: worktreeRoot,
      CODEX_HOME: '/home/worker/.codex',
      HOME: '/home/worker',
    };

    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          containerIdentity: testContainerIdentity,
          env,
          runner,
        }),
      /push network unavailable/
    );
    const retried = runRemediationAutofix({
      candidate,
      containerIdentity: testContainerIdentity,
      env,
      runner,
    });

    assert.equal(retried.type, 'pr_opened');
    assert.equal(codexAttempts, 2);
    assert.equal(pushAttempts, 2);
    assert.equal(imageChecks, 1);
    assert.equal(
      calls.filter((call) => call.join(' ').startsWith('git worktree add'))
        .length,
      1
    );
    assert.equal(
      calls.some(
        (call) =>
          call.join(' ') ===
          `git worktree remove --force ${retainedWorktree.directory}`
      ),
      true
    );
  });
});
