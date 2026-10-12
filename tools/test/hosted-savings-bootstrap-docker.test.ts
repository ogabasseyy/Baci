import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { assertHostedSavingsDocker } from './hosted-savings-bootstrap-docker';

test('rejects remote, arbitrary and missing endpoints before inspecting sockets', async () => {
  for (const endpoint of [
    undefined,
    'ssh://remote',
    'tcp://127.0.0.1:2375',
    'unix:///tmp/other.sock',
  ]) {
    await assert.rejects(
      assertHostedSavingsDocker(endpoint),
      /endpoint required/
    );
  }
});

test('accepts Colima only when the expected local path is a socket', async () => {
  const root = await mkdtemp('/tmp/hosted-savings-bootstrap-');
  const { mkdir } = await import('node:fs/promises');
  const directory = path.join(root, '.colima/default');
  await mkdir(directory, { recursive: true });
  const socket = path.join(directory, 'docker.sock');
  const endpoint = `unix://${socket}`;
  try {
    await writeFile(socket, 'not a socket');
    await assert.rejects(
      assertHostedSavingsDocker(endpoint, root),
      /socket required/
    );
    await rm(socket);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    try {
      assert.equal(await assertHostedSavingsDocker(endpoint, root), endpoint);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
