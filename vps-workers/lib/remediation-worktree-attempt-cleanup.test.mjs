import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanupRemediationAttempt } from './remediation-worktree-attempt-cleanup.mjs';

describe('remediation worktree attempt cleanup', () => {
  it('removes an uncommitted failed attempt by default', () => {
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, ...args]);
      if (args.join(' ') === 'worktree list --porcelain') {
        return { status: 0, stdout: 'worktree /worktrees/failed\n' };
      }
      return { status: 0, stdout: '' };
    };

    cleanupRemediationAttempt(
      {
        childEnv: {},
        repoDir: '/repo',
        runner,
        worktreeDir: '/worktrees/failed',
      },
      false,
      true,
      false,
      false
    );

    assert.equal(
      calls.some((call) => call.includes('remove')),
      true
    );
  });

  it('keeps a committed failed attempt but removes its pnpm store', () => {
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, ...args]);
      if (args.join(' ') === 'worktree list --porcelain') {
        return { status: 0, stdout: 'worktree /worktrees/committed\n' };
      }
      return { status: 0, stdout: '' };
    };

    cleanupRemediationAttempt(
      {
        childEnv: {},
        repoDir: '/repo',
        runner,
        worktreeDir: '/worktrees/committed',
      },
      false,
      true,
      true,
      false
    );

    assert.deepEqual(calls, [
      ['git', 'worktree', 'list', '--porcelain'],
      ['rm', '-rf', '--', '/worktrees/committed-pnpm-store'],
    ]);
  });

  it('deletes the uncommitted branch so the deferred retry can recreate it', () => {
    const calls = [];
    let branchPresent = true;
    const runner = (command, args) => {
      calls.push([command, ...args]);
      const invocation = args.join(' ');
      if (invocation === 'worktree list --porcelain') {
        return { status: 0, stdout: 'worktree /worktrees/failed\n' };
      }
      if (invocation === 'branch --list -- codex/fix-case-1') {
        return {
          status: 0,
          stdout: branchPresent ? '  codex/fix-case-1\n' : '',
        };
      }
      if (invocation === 'branch -D -- codex/fix-case-1') {
        branchPresent = false;
      }
      return { status: 0, stdout: '' };
    };

    cleanupRemediationAttempt(
      {
        branch: 'codex/fix-case-1',
        childEnv: {},
        repoDir: '/repo',
        runner,
        worktreeDir: '/worktrees/failed',
      },
      false,
      true,
      false,
      false
    );

    assert.equal(branchPresent, false);
    assert.deepEqual(calls.at(-2), [
      'git',
      'branch',
      '--list',
      '--',
      'codex/fix-case-1',
    ]);
    assert.deepEqual(calls.at(-1), [
      'git',
      'branch',
      '-D',
      '--',
      'codex/fix-case-1',
    ]);
  });
});
