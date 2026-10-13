import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { remediationGitWorkflowTestFixtures } from './remediation-git-workflow.test-helpers.mjs';

const { candidate, makeRunner } = remediationGitWorkflowTestFixtures;

describe('remediation terminal reconciliation', () => {
  for (const shortcut of ['existing_pr', 'remote_branch']) {
    it(`cleans the retained worktree when ${shortcut} completes a lost PR-create retry`, () => {
      const { calls, runner: baseRunner } = makeRunner();
      let branch = '';
      let prLookups = 0;
      const runner = (command, args, options) => {
        if (command === 'gh' && args.includes('list')) {
          branch = args[args.indexOf('--head') + 1];
          prLookups++;
          if (shortcut === 'existing_pr' || prLookups > 1) {
            return {
              status: 0,
              stdout:
                '[{"url":"https://github.com/ogabasseyy/Baci/pull/999"}]\n',
              stderr: '',
            };
          }
        }
        if (command === 'git' && args.includes('ls-remote')) {
          return {
            status: 0,
            stdout: `deadbeef\trefs/heads/${branch}\n`,
            stderr: '',
          };
        }
        if (
          command === 'git' &&
          args.join(' ') === 'worktree list --porcelain'
        ) {
          return {
            status: 0,
            stdout: `worktree /worktrees/lost-pr-create\nHEAD deadbeef\nbranch refs/heads/${branch}\n`,
            stderr: '',
          };
        }
        return baseRunner(command, args, options);
      };

      const result = runRemediationAutofix({
        candidate,
        env: {
          BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
          BACI_REPO_DIR: '/repo',
          BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
        },
        runner,
      });

      assert.equal(result.type, 'pr_opened');
      assert.equal(result.worktreeDir, '/worktrees/lost-pr-create');
      assert.equal(
        calls.some(
          (call) =>
            call.join(' ') ===
            'git worktree remove --force /worktrees/lost-pr-create'
        ),
        true
      );
      assert.equal(
        calls.some((call) => call.includes('codex')),
        false
      );
    });
  }
});
