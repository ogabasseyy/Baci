import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resumeCommittedRemediationBranch } from './remediation-committed-branch-resume.mjs';

describe('committed remediation branch resume', () => {
  it('pushes, creates a draft, and cleans a branch ahead of origin/main', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args[0] === 'rev-list') return { status: 0, stdout: '1\n' };
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: 'worktree /worktrees/abc123\n',
        };
      }
      return { status: 0, stdout: '' };
    };
    const result = resumeCommittedRemediationBranch({
      prReconciler: {
        branch: 'codex/fix-abc123',
        createOrReuseDraftPr: () =>
          'https://github.com/ogabasseyy/Baci/pull/999',
      },
      rootCommandOptions: {
        cwd: '/repo',
        env: { PATH: '/safe/bin' },
        runner,
      },
      worktreeGitCommandOptions: { cwd: '/worktrees/abc123', env: {}, runner },
      worktreeRemoteCommandOptions: {
        cwd: '/worktrees/abc123',
        env: {},
        runner,
      },
    });

    assert.equal(result.type, 'pr_opened');
    assert.deepEqual(
      calls.slice(-4).map(({ args, command }) => `${command} ${args.join(' ')}`),
      [
        'git worktree list --porcelain',
        'rm -rf -- /worktrees/abc123-pnpm-store',
        'git worktree remove --force /worktrees/abc123',
        'git worktree prune',
      ]
    );
    assert.deepEqual(calls.at(-4).options, {
      cwd: '/repo',
      env: { PATH: '/safe/bin' },
      shell: false,
    });
  });

  it('leaves a branch at origin/main untouched', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      return { status: 0, stdout: '0\n' };
    };

    const result = resumeCommittedRemediationBranch({
      prReconciler: { branch: 'codex/fix-abc123' },
      rootCommandOptions: { cwd: '/repo', env: {}, runner },
      worktreeGitCommandOptions: { cwd: '/worktrees/abc123', env: {}, runner },
      worktreeRemoteCommandOptions: {
        cwd: '/worktrees/abc123',
        env: {},
        runner,
      },
    });

    assert.equal(result, null);
    assert.equal(calls.length, 1);
  });

  it('fails closed when the ahead-count output is invalid', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      return { status: 0, stdout: 'unknown\n' };
    };

    assert.throws(
      () =>
        resumeCommittedRemediationBranch({
          prReconciler: { branch: 'codex/fix-abc123' },
          rootCommandOptions: { cwd: '/repo', env: {}, runner },
          worktreeGitCommandOptions: {
            cwd: '/worktrees/abc123',
            env: {},
            runner,
          },
          worktreeRemoteCommandOptions: {
            cwd: '/worktrees/abc123',
            env: {},
            runner,
          },
        }),
      /invalid output/
    );
    assert.equal(calls.length, 1);
  });
});
