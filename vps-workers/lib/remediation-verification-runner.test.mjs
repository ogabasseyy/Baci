import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REMEDIATION_VERIFY_COMMAND } from './remediation-codex-command.mjs';
import { runRemediationVerification } from './remediation-verification-runner.mjs';

function setup({ docker = false } = {}) {
  const repoDir = mkdtempSync(join(tmpdir(), 'baci-verify-repo-'));
  const worktreeDir = mkdtempSync(join(tmpdir(), 'baci-verify-tree-'));
  const childEnv = { PATH: '/usr/bin' };
  const commandEnv = {
    HOME: repoDir,
    ...(docker
      ? {
          BACI_CODEX_CONTAINER_BIN: '/opt/codex/bin/codex',
          BACI_CODEX_DOCKER_IMAGE: 'baci-remediator:test',
        }
      : {}),
  };
  const runCheckedCalls = [];
  const runnerCalls = [];
  const options = {
    childEnv,
    commandEnv,
    containerIdentity: { gid: 1002, uid: 1001 },
    env: {},
    repoDir,
    runChecked: (command, args, runOptions) => {
      runCheckedCalls.push([command, args, runOptions]);
      return '';
    },
    runner: (command, args, runOptions) => {
      runnerCalls.push([command, args, runOptions]);
      return { status: 0, stderr: '', stdout: '' };
    },
    worktreeCommandOptions: { cwd: worktreeDir, env: childEnv },
    worktreeDir,
  };
  return { options, repoDir, runCheckedCalls, runnerCalls, worktreeDir };
}

describe('runRemediationVerification', () => {
  it('runs the local verification command without container cleanup', () => {
    const { options, runCheckedCalls, runnerCalls } = setup();

    runRemediationVerification(options);

    assert.equal(runCheckedCalls.length, 1);
    assert.equal(runCheckedCalls[0][0], 'bash');
    assert.deepEqual(runCheckedCalls[0][1], [
      '-lc',
      REMEDIATION_VERIFY_COMMAND,
    ]);
    assert.equal(runCheckedCalls[0][2].timeout, 30 * 60 * 1_000);
    assert.deepEqual(runnerCalls, []);
  });

  it('honors the configured verification timeout', () => {
    const { options, runCheckedCalls } = setup();
    options.env = { BACI_REMEDIATION_VERIFY_TIMEOUT_MS: '5000' };

    runRemediationVerification(options);

    assert.equal(runCheckedCalls[0][2].timeout, 5000);
  });

  it('passes the container identity to Docker verification', () => {
    const { options, runCheckedCalls } = setup({ docker: true });

    runRemediationVerification(options);

    const verifyArgs = runCheckedCalls[0][1];
    const userIndex = verifyArgs.indexOf('--user');
    assert.notEqual(userIndex, -1);
    assert.equal(verifyArgs[userIndex + 1], '1001:1002');
  });

  it('removes the container and dependency copies when verification fails', () => {
    const { options, runCheckedCalls, runnerCalls, worktreeDir } = setup({
      docker: true,
    });
    const verifyError = new Error('verify failed');
    options.runChecked = (command, args, runOptions) => {
      runCheckedCalls.push([command, args, runOptions]);
      if (command === 'docker') throw verifyError;
      return '';
    };

    assert.throws(() => runRemediationVerification(options), /verify failed/);
    assert.equal(runnerCalls.length, 1);
    assert.equal(runnerCalls[0][0], 'docker');
    assert.match(runnerCalls[0][1].join(' '), /rm -f baci-remediation-.*-verify/);
    const removals = runCheckedCalls
      .filter(([command]) => command === 'rm')
      .map(([, args]) => args.join(' '));
    assert.deepEqual(
      removals.map((args) =>
        args.replace(worktreeDir, '<worktree>').replace(/\\/g, '/')
      ),
      [
        'node_modules',
        'apps/web/node_modules',
        'apps/mobile-admin/node_modules',
        'apps/mobile-storefront/node_modules',
      ].map((relativePath) => `-rf -- <worktree>/${relativePath}`)
    );
  });
});
