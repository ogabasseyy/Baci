import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { remediationGitWorkflowTestFixtures } from './remediation-git-workflow.test-helpers.mjs';

const { candidate, makeRunner } = remediationGitWorkflowTestFixtures;

describe('remediation git workflow policy and configuration', () => {
  it('blocks PR creation when protected files changed', () => {
    const { calls, runner } = makeRunner({
      changedFiles: 'apps/web/src/proxy.ts\n',
    });

    const result = runRemediationAutofix({
      candidate,
      env: {
        BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
        BACI_REPO_DIR: '/repo',
        BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
      },
      prompt: 'Fix this production error.',
      runner,
    });

    assert.equal(result.type, 'policy_blocked');
    assert.match(result.reasons.join('\n'), /protected path/);
    assert.equal(
      calls.some((call) => call.includes('push')),
      false
    );
    assert.equal(
      calls.some((call) => call.includes('remove')),
      true
    );
  });

  it('blocks protected rename sources before PR creation', () => {
    const { calls, runner } = makeRunner({
      statusOutput: 'R  apps/web/src/proxy.ts -> apps/web/src/proxy-safe.ts',
    });

    const result = runRemediationAutofix({
      candidate,
      env: {
        BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
        BACI_REPO_DIR: '/repo',
        BACI_REMEDIATION_RUN_ID: 'rename-run',
        BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
      },
      prompt: 'Fix this production error.',
      runner,
    });

    assert.equal(result.type, 'policy_blocked');
    assert.deepEqual(result.changedFiles, [
      'apps/web/src/proxy.ts',
      'apps/web/src/proxy-safe.ts',
    ]);
    assert.match(result.reasons.join('\n'), /protected path/);
    assert.equal(
      calls.some((call) => call.includes('push')),
      false
    );
  });

  it('uses immutable verification gates instead of arbitrary configured commands', () => {
    const { calls, runner } = makeRunner();

    const result = runRemediationAutofix({
      candidate,
      env: {
        BACI_REMEDIATION_VERIFY_COMMAND: 'echo untrusted override',
        BACI_REPO_DIR: '/repo',
        BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
      },
      prompt: 'Fix this production error.',
      runner,
    });

    assert.equal(result.type, 'pr_opened');
    assert.equal(
      calls.some(
        (call) =>
          call.join(' ') ===
          'bash -lc pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test'
      ),
      true
    );
    assert.equal(
      calls.some((call) => call.includes('echo untrusted override')),
      false
    );
  });

  it('removes an uncommitted worktree when verification fails', () => {
    const { calls, runner } = makeRunner({
      verificationResult: {
        status: 1,
        stderr: 'focused regression failed',
        stdout: '',
      },
    });

    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          env: {
            BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo test',
            BACI_REPO_DIR: '/repo',
            BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
          },
          runner,
        }),
      /focused regression failed/
    );
    assert.equal(
      calls.some((call) => call.includes('remove')),
      true
    );
  });

  it('requires an explicit repo checkout', () => {
    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          env: {},
          prompt: 'Fix this production error.',
          runner: makeRunner().runner,
        }),
      /BACI_REPO_DIR is required/
    );
  });
});
