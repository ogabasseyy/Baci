import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

test('SIGTERM removes owned Docker resources', { timeout: 30000 }, async () => {
  const child = spawn(
    process.execPath,
    ['apps/web/tools/builder-preview-spike/privacy-probe.mjs'],
    {
      env: { ...process.env, BACI_BUILDER_PROBE_ABORT_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let resources;
  try {
    const [chunk] = await once(child.stdout, 'data', {
      signal: AbortSignal.timeout(15000),
    });
    resources = JSON.parse(chunk.toString());
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    for (const name of [resources.api, resources.db]) {
      assert.throws(
        () =>
          execFileSync('docker', ['inspect', name], {
            stdio: 'pipe',
            timeout: 5000,
          }),
        `Leaked container ${name}`
      );
    }
    assert.throws(
      () =>
        execFileSync('docker', ['network', 'inspect', resources.network], {
          stdio: 'pipe',
          timeout: 5000,
        }),
      'Leaked network'
    );
  } finally {
    child.kill('SIGKILL');
    if (resources) {
      for (const name of [resources.api, resources.db]) {
        try {
          execFileSync('docker', ['rm', '-f', name], {
            stdio: 'pipe',
            timeout: 5000,
          });
        } catch {
          /* test cleanup */
        }
      }
      try {
        execFileSync('docker', ['network', 'rm', resources.network], {
          stdio: 'pipe',
          timeout: 5000,
        });
      } catch {
        /* test cleanup */
      }
    }
  }
});
