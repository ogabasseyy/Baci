import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  enterRemediationGlobalLock,
  runRemediationJobWithGlobalLock,
} from './remediation-global-lock.mjs';

describe('remediation global lock capability', () => {
  it('does not mint a test capability when NODE_TEST_CONTEXT is forged', () => {
    const moduleUrl = new URL('./remediation-global-lock.mjs', import.meta.url)
      .href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import * as lock from '${moduleUrl}'; if ('createTestRemediationGlobalLockCapability' in lock) process.exitCode = 99;`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });

  it('does not treat a forged environment marker as lock ownership', () => {
    let invocation;
    const result = enterRemediationGlobalLock({
      env: { BACI_REMEDIATION_GLOBAL_FLOCK_HELD: '1' },
      runner(command, args, options) {
        invocation = { args, command, options };
        return { status: 75 };
      },
      scriptPath: '/srv/baci/vps-workers/jobs/vercel-error-remediator.mjs',
    });

    assert.equal(result.capability, null);
    assert.equal(result.exitCode, 75);
    assert.equal(invocation.command, 'flock');
  });

  it('preserves a failed reexecuted child status without running locally', async () => {
    let ran = false;
    const exitCode = await runRemediationJobWithGlobalLock({
      main() {
        ran = true;
      },
      runner() {
        return { status: 23 };
      },
      scriptPath: '/srv/baci/vps-workers/jobs/vercel-error-remediator.mjs',
    });

    assert.equal(exitCode, 23);
    assert.equal(ran, false);
  });

  it('waits for the canary global lock without changing the child arguments', () => {
    let invocation;
    const result = enterRemediationGlobalLock({
      argv: ['--scheduled'],
      runner(command, args) {
        invocation = { args, command };
        return { status: 75 };
      },
      scriptPath: '/srv/baci/vps-workers/jobs/remediation-codex-canary.mjs',
      waitSeconds: 600,
    });

    assert.equal(result.exitCode, 75);
    assert.deepEqual(invocation, {
      args: [
        '-F',
        '-w',
        '600',
        '-E',
        '75',
        '/srv/baci/vps-workers/locks/error-remediator-global.lock',
        process.execPath,
        '/srv/baci/vps-workers/jobs/remediation-codex-canary.mjs',
        '--scheduled',
      ],
      command: 'flock',
    });
  });
});
