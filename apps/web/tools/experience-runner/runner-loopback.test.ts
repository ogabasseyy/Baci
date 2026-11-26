import { createHmac } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { startRunnerLoopback } from './runner-loopback';
import { createRunnerSocket } from './runner-socket';
import { createRunnerHandler } from './runner-transport';

it('forwards signed requests through the private socket and rejects all other routes', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'runner-loop-')));
  const socketPath = join(dir, 'runner.sock');
  const key = Buffer.alloc(32, 7);
  const execute = vi.fn(async () => ({
    output: { ok: true },
    wallMs: 1,
    jobId: 'test',
  }));
  const handler = createRunnerHandler({
    key,
    toolchainDigest: 'a'.repeat(64),
    now: () => 100000,
    execute,
  });
  const socket = await createRunnerSocket({ socketPath, handler });
  const gateway = await startRunnerLoopback({ socketPath, port: 0 });
  const body = JSON.stringify({
    version: 1,
    nonce: 'b'.repeat(64),
    expiresAt: 160000,
    toolchainDigest: 'a'.repeat(64),
    lane: 'owner',
    kind: 'compile',
    payload: {},
  });
  const signature = createHmac('sha256', key)
    .update(`request\n${body}`)
    .digest('hex');
  try {
    expect(
      (await fetch(`${gateway.origin}/other`, { method: 'POST', body })).status
    ).toBe(404);
    expect(
      (
        await fetch(`${gateway.origin}/v1/execute`, {
          method: 'POST',
          body,
          headers: { 'x-baci-runner-signature': 'invalid' },
        })
      ).status
    ).toBe(401);
    const response = await fetch(`${gateway.origin}/v1/execute`, {
      method: 'POST',
      body,
      headers: { 'x-baci-runner-signature': signature },
    });
    const responseBody = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-baci-runner-signature')).toBe(
      createHmac('sha256', key)
        .update(`response\n${responseBody}`)
        .digest('hex')
    );
    expect(
      (
        await fetch(`${gateway.origin}/v1/execute`, {
          method: 'POST',
          body,
          headers: { 'x-baci-runner-signature': signature },
        })
      ).status
    ).toBe(409);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await gateway.close();
    await socket.close();
    await rm(dir, { recursive: true, force: true });
  }
});
