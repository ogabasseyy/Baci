import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
    const dependency = join(worktreeDir, 'apps/mobile-admin/node_modules');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, 'marker'), 'copied');
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
    assert.equal(runCheckedCalls.some(([command]) => command === 'rm'), false);
    assert.equal(existsSync(dependency), false);
  });

  it('preserves the verification error when cleanup encounters a symlink', () => {
    const { options, runCheckedCalls, worktreeDir } = setup({ docker: true });
    const outsideRoot = mkdtempSync(join(tmpdir(), 'baci-verify-outside-'));
    const outsideDependencies = join(outsideRoot, 'node_modules');
    mkdirSync(outsideDependencies);
    writeFileSync(join(outsideDependencies, 'keep'), 'outside');
    const verifyError = new Error('verify failed');
    options.runChecked = (command, args, runOptions) => {
      runCheckedCalls.push([command, args, runOptions]);
      if (command === 'docker') {
        mkdirSync(join(worktreeDir, 'apps'));
        symlinkSync(outsideRoot, join(worktreeDir, 'apps/mobile-admin'));
        throw verifyError;
      }
      return '';
    };

    assert.throws(() => runRemediationVerification(options), /verify failed/);
    assert.equal(existsSync(join(outsideDependencies, 'keep')), true);
  });

  it('removes real dependency copies after successful verification', () => {
    const { options, worktreeDir } = setup({ docker: true });
    const dependency = join(worktreeDir, 'apps/mobile-admin/node_modules');
    mkdirSync(dependency, { recursive: true });
    writeFileSync(join(dependency, 'marker'), 'copied');

    runRemediationVerification(options);

    assert.equal(existsSync(dependency), false);
  });

  it('refuses cleanup through a symlinked worktree ancestor', () => {
    const { options, worktreeDir } = setup({ docker: true });
    const outsideRoot = mkdtempSync(join(tmpdir(), 'baci-verify-outside-'));
    const outsideDependencies = join(outsideRoot, 'node_modules');
    mkdirSync(outsideDependencies);
    writeFileSync(join(outsideDependencies, 'keep'), 'outside');
    mkdirSync(join(worktreeDir, 'apps'));
    symlinkSync(outsideRoot, join(worktreeDir, 'apps/mobile-admin'));

    assert.throws(
      () => runRemediationVerification(options),
      /Refusing remediation cleanup through a symlink/
    );
    assert.equal(existsSync(join(outsideDependencies, 'keep')), true);
  });
});
