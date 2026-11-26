import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAuthListener } from './auth-listener.ts';

test('recovers the private socket after an unclean broker exit', {
  timeout: 10000,
}, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const socketPath = join(dir, 'broker.sock');
  const oldProcess = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { createServer } from 'node:net'; createServer().listen(process.argv[1], () => process.stdout.write('ready'));",
      socketPath,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const exited = once(oldProcess, 'exit');
  try {
    await Promise.race([
      once(oldProcess.stdout, 'data'),
      exited.then(() => {
        throw Error('Fixture broker exited before listening');
      }),
    ]);
    oldProcess.kill('SIGKILL');
    await exited;
    assert.equal((await lstat(socketPath)).isSocket(), true);

    const listener = await createAuthListener({
      socketPath,
      authority: 'builder-auth.usebaci.com',
      handler: async (_req, res) => {
        res.end();
      },
    });
    await listener.close();
  } finally {
    if (oldProcess.exitCode === null && oldProcess.signalCode === null)
      oldProcess.kill('SIGKILL');
    await exited.catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not replace the existing private socket while another broker listens', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const socketPath = join(dir, 'broker.sock');
  const settings = {
    socketPath,
    authority: 'builder-auth.usebaci.com',
    handler: async (_req: unknown, res: ServerResponse) => {
      res.end();
    },
  };
  const listener = await createAuthListener(settings);
  try {
    const original = await lstat(socketPath);
    await assert.rejects(() => createAuthListener(settings));
    assert.equal((await lstat(socketPath)).ino, original.ino);
  } finally {
    await listener.close();
    await rm(dir, { recursive: true, force: true });
  }
});
