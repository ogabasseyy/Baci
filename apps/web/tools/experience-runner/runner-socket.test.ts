import { createHmac } from 'node:crypto';
import { chmod, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { startRunnerService } from './runner-service';
import { createRunnerSocket } from './runner-socket';
import { createRunnerHandler } from './runner-transport';

it('serves only signed runner requests through a private socket', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'runner-socket-')));
  const socketPath = join(dir, 'runner.sock');
  const key = new Uint8Array(32).fill(7);
  const execute = vi.fn(async () => ({
    output: { ok: true },
    wallMs: 1,
    jobId: 'synthetic',
  }));
  const handler = createRunnerHandler({
    key,
    toolchainDigest: 'a'.repeat(64),
    now: () => 100000,
    execute,
  });
  const listener = await createRunnerSocket({ socketPath, handler });
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
  const send = (path: string, signed: boolean) =>
    new Promise<{ status: number; body: string; signature?: string }>(
      (resolve, reject) => {
        const req = request(
          {
            socketPath,
            path,
            method: 'POST',
            headers: {
              'x-baci-runner-signature': signed ? signature : 'invalid',
            },
          },
          (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              text += chunk;
            });
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                body: text,
                signature: res.headers['x-baci-runner-signature'] as
                  | string
                  | undefined,
              })
            );
          }
        );
        req.on('error', reject);
        req.end(body);
      }
    );
  try {
    expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);
    expect((await send('/other', true)).status).toBe(404);
    expect((await send('/v1/execute', false)).status).toBe(401);
    const result = await send('/v1/execute', true);
    expect(result.status).toBe(200);
    expect(result.signature).toBe(
      createHmac('sha256', key).update(`response\n${result.body}`).digest('hex')
    );
    expect((await send('/v1/execute', true)).status).toBe(409);
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('refuses a socket in a directory accessible by other users', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'runner-socket-')));
  try {
    await chmod(dir, 0o777);
    await expect(
      createRunnerSocket({
        socketPath: join(dir, 'runner.sock'),
        handler: async () => new Response(),
      })
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('opens ingress only after runner installation verification succeeds', async () => {
  const order: string[] = [];
  const socket = vi.fn(async () => {
    order.push('listen');
    return {
      close: async () => {
        order.push('close');
      },
    };
  });
  const settings = {
    key: new Uint8Array(32),
    toolchainDigest: 'a'.repeat(64),
    socketPath: '/run/baci-runner/runner.sock',
    verifyInstallation: async () => ({ toolchainDigest: 'a'.repeat(64) }),
  };
  await expect(
    startRunnerService(settings, {
      createRunner: async () => {
        throw Error('BAD_INSTALLATION');
      },
      createSocket: socket,
    })
  ).rejects.toThrow('BAD_INSTALLATION');
  expect(socket).not.toHaveBeenCalled();
  const service = await startRunnerService(settings, {
    createRunner: async () => {
      order.push('verify');
      return async () => new Response();
    },
    createSocket: socket,
  });
  expect(order).toEqual(['verify', 'listen']);
  await service.close();
  expect(order).toEqual(['verify', 'listen', 'close']);
});
