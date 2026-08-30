import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REMEDIATION_VERIFY_COMMAND } from './remediation-codex-command.mjs';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { remediationGitWorkflowTestFixtures } from './remediation-git-workflow.test-helpers.mjs';

const { candidate, makeRunner } = remediationGitWorkflowTestFixtures;
const dockerEnvironment = {
  BACI_CODEX_DOCKER_IMAGE: 'baci-codex-remediator:local',
  BACI_CODEX_CONTAINER_BIN: '/opt/host/codex-native',
  BACI_REMEDIATION_VERIFY_COMMAND: 'pnpm turbo lint',
  BACI_REPO_DIR: '/repo',
  BACI_REMEDIATION_WORKTREE_ROOT: '/worktrees',
  CODEX_HOME: '/home/worker/.codex',
  HOME: '/home/worker',
};

describe('remediation Docker workflow', () => {
  it('does not create a worktree when the configured image is unavailable', () => {
    const { calls, runner: baseRunner } = makeRunner();
    const runner = (command, args, options) => {
      if (command === 'docker' && args[0] === 'image') {
        calls.push([command, ...args]);
        return {
          status: 1,
          stderr: 'Error response from daemon: pull access denied',
          stdout: '',
        };
      }
      return baseRunner(command, args, options);
    };

    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          env: dockerEnvironment,
          runner,
        }),
      /configured BACI_CODEX_DOCKER_IMAGE is unavailable/
    );
    assert.equal(
      calls.some((call) => call.join(' ').startsWith('git worktree add')),
      false
    );
  });

  it('removes a newly created worktree when the image disappears after preflight', () => {
    const { calls, runner: baseRunner } = makeRunner();
    const runner = (command, args, options) => {
      if (command === 'docker' && args[0] === 'run') {
        calls.push([command, ...args]);
        return {
          status: 1,
          stderr: 'Unable to find image baci-codex-remediator:local locally',
          stdout: '',
        };
      }
      return baseRunner(command, args, options);
    };

    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          env: {
            ...dockerEnvironment,
            BACI_REMEDIATION_RUN_ID: 'image-race-run',
          },
          runner,
        }),
      /Unable to find image/
    );
    assert.equal(
      calls.some((call) => call.join(' ').includes('worktree remove --force')),
      true
    );
  });

  it('runs Codex in a hardened Docker container', () => {
    const { calls, runner } = makeRunner({ statusOutput: '' });
    const result = runRemediationAutofix({
      candidate,
      env: {
        ...dockerEnvironment,
        BACI_REMEDIATION_OUTPUT_DIR: mkdtempSync(
          join(tmpdir(), 'baci-remediation-output-')
        ),
      },
      runner,
    });

    assert.equal(result.type, 'no_changes');
    const dockerCall = calls.find(
      ([command, ...args]) =>
        command === 'docker' &&
        args.includes('--dangerously-bypass-approvals-and-sandbox')
    );
    assert.ok(dockerCall);
    assert.equal(dockerCall.includes('--cap-drop'), true);
    assert.equal(dockerCall.includes('ALL'), true);
    assert.equal(
      dockerCall.includes('--dangerously-bypass-approvals-and-sandbox'),
      true
    );
    assert.equal(
      calls.some(
        ([command, ...args]) =>
          command === 'docker' && args.includes('--read-only')
      ),
      true
    );
    assert.equal(
      calls.some(
        (call) =>
          call.slice(0, 3).join(' ') === 'docker rm -f' &&
          call[3]?.startsWith('baci-remediation-abc123-')
      ),
      true
    );
  });

  it('runs verification with dependency mounts', () => {
    const { calls, runner } = makeRunner();
    const worktreeRoot = mkdtempSync(
      join(tmpdir(), 'baci-remediation-worktrees-')
    );
    const dependencyRoot = mkdtempSync(
      join(tmpdir(), 'baci-remediation-dependencies-')
    );
    mkdirSync(join(dependencyRoot, 'node_modules'));
    const result = runRemediationAutofix({
      candidate,
      env: {
        ...dockerEnvironment,
        BACI_REMEDIATION_WORKTREE_ROOT: worktreeRoot,
        BACI_REMEDIATION_DEPENDENCY_ROOT: dependencyRoot,
        BACI_REMEDIATION_RUN_ID: 'verify-run',
      },
      runner,
    });

    assert.equal(result.type, 'pr_opened');
    const verificationCall = calls.find(
      ([command, ...args]) =>
        command === 'docker' &&
        args.some((arg) => arg.includes(REMEDIATION_VERIFY_COMMAND))
    );
    assert.ok(verificationCall);
    assert.equal(
      verificationCall.includes(
        `type=bind,src=${dependencyRoot}/node_modules,dst=/opt/remediation-dependencies/node_modules,readonly`
      ),
      true
    );
    const verificationScript = verificationCall.at(-1);
    const verifyPosition = verificationScript.lastIndexOf(
      REMEDIATION_VERIFY_COMMAND
    );
    assert.ok(verificationScript.indexOf('cp -a') < verifyPosition);
    for (const relativePath of [
      'node_modules',
      'apps/web/node_modules',
      'apps/mobile-admin/node_modules',
      'apps/mobile-storefront/node_modules',
    ]) {
      assert.match(
        verificationScript,
        new RegExp(`cp -a \\"/opt/remediation-dependencies/${relativePath}`)
      );
    }
    assert.match(
      verificationScript,
      new RegExp(` && ${REMEDIATION_VERIFY_COMMAND.replaceAll(' ', '\\s')}$`)
    );
    assert.equal(
      verificationCall.includes('pnpm_config_store_dir=/pnpm-store'),
      true
    );
    assert.equal(
      calls.some(
        (call) => call.join(' ') === `bash -lc ${REMEDIATION_VERIFY_COMMAND}`
      ),
      false
    );
  });

  it('force-removes a Docker container when Codex times out', () => {
    const { calls, runner: baseRunner } = makeRunner({ statusOutput: '' });
    const runner = (command, args, options) => {
      const result = baseRunner(command, args, options);
      return command === 'docker' && args[0] === 'run'
        ? { error: new Error('spawnSync docker ETIMEDOUT') }
        : result;
    };

    assert.throws(
      () =>
        runRemediationAutofix({
          candidate,
          env: {
            ...dockerEnvironment,
            BACI_REMEDIATION_RUN_ID: 'timeout-run',
          },
          runner,
        }),
      /ETIMEDOUT/
    );
    assert.equal(
      calls.some(
        (call) =>
          call.join(' ') === 'docker rm -f baci-remediation-abc123-timeout-run'
      ),
      true
    );
  });
});
