import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findRetainedRemediationWorktree } from './remediation-retained-worktree.mjs';

describe('retained remediation worktree lookup', () => {
  it('finds the registered worktree for its branch', () => {
    const runner = () => ({
      status: 0,
      stdout:
        'worktree /repo\nHEAD deadbeef\nbranch refs/heads/main\n\nworktree /worktrees/abc123-retry-run\nHEAD deadbeef\nbranch refs/heads/codex/fix-abc123\n',
      stderr: '',
    });

    const result = findRetainedRemediationWorktree({
      branch: 'codex/fix-abc123',
      childEnv: {},
      repoDir: '/repo',
      runner,
    });

    assert.equal(result, '/worktrees/abc123-retry-run');
  });

  it('does not return a worktree registered to another branch', () => {
    const runner = () => ({
      status: 0,
      stdout:
        'worktree /worktrees/abc123-retry-run\nHEAD deadbeef\nbranch refs/heads/codex/other-fix\n',
      stderr: '',
    });

    const result = findRetainedRemediationWorktree({
      branch: 'codex/fix-abc123',
      childEnv: {},
      repoDir: '/repo',
      runner,
    });

    assert.equal(result, '');
  });

  it('ignores a branch whose name shares the requested prefix', () => {
    const runner = () => ({
      status: 0,
      stdout:
        'worktree /worktrees/other\nHEAD deadbeef\nbranch refs/heads/codex/fix-abc1234\n',
      stderr: '',
    });

    assert.equal(
      findRetainedRemediationWorktree({
        branch: 'codex/fix-abc123',
        childEnv: {},
        repoDir: '/repo',
        runner,
      }),
      ''
    );
  });

  it('fails closed when git cannot list worktrees', () => {
    const runner = () => ({
      status: 128,
      stdout: '',
      stderr: 'not a git repository',
    });

    assert.throws(
      () =>
        findRetainedRemediationWorktree({
          branch: 'codex/fix-abc123',
          childEnv: {},
          repoDir: '/repo',
          runner,
        }),
      /git worktree list --porcelain failed/
    );
  });
});
