import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanupRemediationWorktree } from './remediation-worktree-cleanup.mjs';

describe('remediation worktree cleanup', () => {
  it('force-removes a completed worktree with the child environment', () => {
    const calls = [];
    const childEnv = { PATH: '/safe/bin' };
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: 'worktree /worktrees/completed\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    cleanupRemediationWorktree({
      childEnv,
      repoDir: '/repo',
      runner,
      worktreeDir: '/worktrees/completed',
    });

    assert.deepEqual(calls, [
      {
        args: ['worktree', 'list', '--porcelain'],
        command: 'git',
        options: { cwd: '/repo', env: childEnv, shell: false },
      },
      {
        args: ['-rf', '--', '/worktrees/completed-pnpm-store'],
        command: 'rm',
        options: { cwd: '/repo', env: childEnv, shell: false },
      },
      {
        args: ['worktree', 'remove', '--force', '/worktrees/completed'],
        command: 'git',
        options: { cwd: '/repo', env: childEnv, shell: false },
      },
      {
        args: ['worktree', 'prune'],
        command: 'git',
        options: { cwd: '/repo', env: childEnv, shell: false },
      },
    ]);
  });

  it('does nothing when there is no worktree to clean up', () => {
    const calls = [];

    cleanupRemediationWorktree({
      childEnv: {},
      repoDir: '/repo',
      runner: (...args) => calls.push(args),
      worktreeDir: '',
    });

    assert.deepEqual(calls, []);
  });

  it('removes a retained run store without unregistering the worktree', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: 'worktree /worktrees/committed\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    cleanupRemediationWorktree({
      childEnv: {},
      removeWorktree: false,
      repoDir: '/repo',
      runner,
      worktreeDir: '/worktrees/committed',
    });

    assert.deepEqual(
      calls.map(({ command, args }) => `${command} ${args.join(' ')}`),
      [
        'git worktree list --porcelain',
        'rm -rf -- /worktrees/committed-pnpm-store',
      ]
    );
  });

  it('does not remove an explicit worktree after its first cleanup unregisters it', () => {
    const calls = [];
    let registered = true;
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: registered ? 'worktree /worktrees/completed\n' : '',
          stderr: '',
        };
      }
      if (args.join(' ') === 'worktree remove --force /worktrees/completed') {
        if (!registered) {
          return { status: 1, stdout: '', stderr: 'worktree is missing' };
        }
        registered = false;
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const options = {
      childEnv: {},
      repoDir: '/repo',
      runner,
      worktreeDir: '/worktrees/completed',
    };

    assert.equal(cleanupRemediationWorktree(options), '/worktrees/completed');
    assert.equal(cleanupRemediationWorktree(options), '');
    assert.equal(
      calls.filter(
        ({ args }) =>
          args.join(' ') === 'worktree remove --force /worktrees/completed'
      ).length,
      1
    );
  });

  it('removes an explicit worktree when Git registers its canonical path', (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-worktree-path-'));
    const physicalRoot = join(directory, 'physical');
    const logicalRoot = join(directory, 'logical');
    const registeredWorktree = join(physicalRoot, 'completed');
    const requestedWorktree = join(logicalRoot, 'completed');
    mkdirSync(registeredWorktree, { recursive: true });
    symlinkSync(physicalRoot, logicalRoot, 'dir');
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout: `worktree ${realpathSync(registeredWorktree)}\n`,
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    assert.equal(
      cleanupRemediationWorktree({
        childEnv: {},
        repoDir: '/repo',
        runner,
        worktreeDir: requestedWorktree,
      }),
      realpathSync(registeredWorktree)
    );
    assert.equal(
      calls.some(
        ({ args }) =>
          args.join(' ') ===
          `worktree remove --force ${realpathSync(registeredWorktree)}`
      ),
      true
    );
  });

  it('discovers and cleans the registered deterministic branch worktree', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ args, command, options });
      if (args.join(' ') === 'worktree list --porcelain') {
        return {
          status: 0,
          stdout:
            'worktree /worktrees/lost-pr-create\nHEAD deadbeef\nbranch refs/heads/codex/fix-abc123\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    const result = cleanupRemediationWorktree({
      branch: 'codex/fix-abc123',
      childEnv: {},
      repoDir: '/repo',
      runner,
    });

    assert.equal(result, '/worktrees/lost-pr-create');
    assert.equal(
      calls.at(-2).args.join(' '),
      'worktree remove --force /worktrees/lost-pr-create'
    );
    assert.equal(calls.at(-1).args.join(' '), 'worktree prune');
    assert.equal(
      `${calls.at(-3).command} ${calls.at(-3).args.join(' ')}`,
      'rm -rf -- /worktrees/lost-pr-create-pnpm-store'
    );
  });

  it('surfaces a cleanup failure instead of claiming the worktree was removed', () => {
    assert.throws(
      () =>
        cleanupRemediationWorktree({
          childEnv: {},
          repoDir: '/repo',
          runner: () => ({
            status: 1,
            stdout: '',
            stderr: 'worktree is locked',
          }),
          worktreeDir: '/worktrees/locked',
        }),
      /worktree is locked/
    );
  });
});
