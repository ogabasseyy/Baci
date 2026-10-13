import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runRemediationChecked } from './remediation-subprocess.mjs';

describe('remediation checked subprocess', () => {
  it('returns stdout from a successful command', () => {
    const result = runRemediationChecked('git', ['status'], {
      cwd: '/repo',
      env: {},
      runner: () => ({ status: 0, stdout: ' M file.ts\n', stderr: '' }),
    });

    assert.equal(result, ' M file.ts\n');
  });

  it('rejects a nonzero command with bounded diagnostics', () => {
    assert.throws(
      () =>
        runRemediationChecked('git', ['status'], {
          cwd: '/repo',
          env: {},
          runner: () => ({
            status: 1,
            stdout: '',
            stderr: 'permission denied',
          }),
        }),
      /permission denied/
    );
  });

  it('redacts and bounds command arguments in a failed command', () => {
    const secret = 'token=must-not-appear';
    assert.throws(
      () =>
        runRemediationChecked('gh', ['pr', 'create', secret, 'x'.repeat(500)], {
          cwd: '/repo',
          env: {},
          runner: () => ({ status: 1, stdout: '', stderr: '' }),
        }),
      (error) => {
        assert.doesNotMatch(error.message, /must-not-appear/);
        assert.ok(error.message.length < 300);
        return true;
      }
    );
  });

  it('redacts a spawn error and forwards defined command options', () => {
    let received;
    assert.throws(
      () =>
        runRemediationChecked('git', ['status'], {
          cwd: '/repo',
          env: { A: '1' },
          runner: (_command, _args, options) => {
            received = options;
            return { error: new Error('spawn token=must-not-appear') };
          },
          timeout: 1_000,
        }),
      (error) => !/must-not-appear/.test(error.message)
    );
    assert.deepEqual(received, {
      cwd: '/repo',
      env: { A: '1' },
      shell: false,
      timeout: 1_000,
    });
  });

  it('omits an undefined command timeout', () => {
    let received;
    runRemediationChecked('git', ['status'], {
      cwd: '/repo',
      env: { A: '1' },
      runner: (_command, _args, options) => {
        received = options;
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.deepEqual(received, { cwd: '/repo', env: { A: '1' }, shell: false });
  });
});
