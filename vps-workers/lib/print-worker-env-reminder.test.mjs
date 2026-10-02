import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

describe('worker env reminder', () => {
  it('prints the reviewed template with the worker token line', () => {
    const output = execFileSync(
      'bash',
      [
        '-c',
        'source "$1" && print_worker_env_reminder /home/bassey/baci-workers',
        'bash',
        join(directory, 'print-worker-env-reminder.sh'),
      ],
      { encoding: 'utf8' }
    );

    assert.match(output, /Reminder: create \/home\/bassey\/baci-workers\/\.env/);
    assert.match(output, /GIGL_TRACKING_WORKER_TOKEN=\.\.\./);
    assert.match(output, /silently skips that platform/);
  });

  it('keeps explanations off assignment lines for raw readers', () => {
    // provision/flip/run-web-script extract BACI_REPO_DIR with a raw
    // `^KEY=` match that keeps trailing text, so an inline `# ...`
    // comment would become part of the path. Explanations must live on
    // their own comment lines instead.
    const output = execFileSync(
      'bash',
      [
        '-c',
        'source "$1" && print_worker_env_reminder /home/bassey/baci-workers',
        'bash',
        join(directory, 'print-worker-env-reminder.sh'),
      ],
      { encoding: 'utf8' }
    );

    const offenders = output
      .split('\n')
      .filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .filter((line) => line.includes('#'));
    assert.deepEqual(offenders, []);
  });

  it('is sourced and called by the deploy script', () => {
    const deployScript = readFileSync(
      join(directory, '..', 'deploy.sh'),
      'utf8'
    );

    assert.match(
      deployScript,
      /source "\$WORKER_ROOT\/lib\/print-worker-env-reminder\.sh"/
    );
    assert.match(deployScript, /print_worker_env_reminder "\$REMOTE_DIR"/);
    assert.ok(
      deployScript.split('\n').length <= 301,
      `deploy.sh exceeds the 300-line limit: ${deployScript.split('\n').length} lines`
    );
  });
});
