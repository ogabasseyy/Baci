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
