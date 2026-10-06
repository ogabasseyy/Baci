// @vitest-environment node
import { request as httpRequest } from 'node:http';
import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));

const listeners: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((server) => server.close()));
});

async function start() {
  const source = cancellationRecoveryFixture();
  const createRlsClient = vi.fn(
    async (_request: NextRequest) => source.options.supabase
  );
  const options = {
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: source.goalId,
      context: source.options.configuration,
      termsDocument: {
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text: 'Synthetic only',
      },
    },
    createRlsClient,
    execute: source.execute,
  };
  const server = await startPiggyvestRuntimeCompositionServer(options);
  listeners.push(server);
  return {
    ...source,
    ...server,
    options,
    createRlsClient,
    client: source.options.supabase,
  };
}

async function bootstrapHeaders(origin: string) {
  const response = await fetch(`${origin}/csrf`, { headers: { origin } });
  expect(response.status).toBe(200);
  const { csrfToken } = await response.json();
  return {
    origin,
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
    'x-csrf-token': csrfToken as string,
    'content-type': 'application/json',
  };
}

describe('real loopback HTTP savings application', () => {
  it('binds only numeric loopback and routes actual recovery over HTTP', async () => {
    const server = await start();
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(
      `${server.origin}/recovery?goalId=${server.goalId}&operationId=${server.operationId}`
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(server.prepared);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not bind with absent configuration', async () => {
    await expect(
      startPiggyvestRuntimeCompositionServer({
        port: 0,
        configuration: undefined,
        createRlsClient: vi.fn(),
        execute: vi.fn(),
      })
    ).rejects.toThrow('Local savings runtime unavailable');
  });

  it('rejects TRACE at the HTTP boundary with 405 rather than a constructor failure', async () => {
    const server = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${server.origin}/cancel`,
        { method: 'TRACE' },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        }
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(405);
    expect(server.createRlsClient).not.toHaveBeenCalled();
  });

  it('rejects hostile Host and absolute request targets without authenticating', async () => {
    const server = await start();
    for (const [path, host] of [
      ['/recovery', 'evil.invalid'],
      ['http://evil.invalid/recovery', new URL(server.origin).host],
    ]) {
      const result = await new Promise<number | undefined>(
        (resolve, reject) => {
          const request = httpRequest(
            server.origin,
            { path, headers: { host } },
            (response) => {
              response.resume();
              response.on('end', () => resolve(response.statusCode));
            }
          );
          request.on('error', reject);
          request.end();
        }
      );
      expect(result).toBe(400);
    }
    expect(server.createRlsClient).not.toHaveBeenCalled();
  });

  it('enforces actual CSRF over HTTP before rejecting invalid JSON and excessive bodies', async () => {
    const server = await start();
    const headers = await bootstrapHeaders(server.origin);
    expect(
      (
        await fetch(`${server.origin}/cancel`, {
          method: 'POST',
          headers: { ...headers, 'x-csrf-token': 'wrong' },
          body: '{}',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${server.origin}/cancel`, {
          method: 'POST',
          headers,
          body: '{broken',
        })
      ).status
    ).toBe(400);
    expect(
      (
        await fetch(`${server.origin}/cancel`, {
          method: 'POST',
          headers,
          body: ' '.repeat(4097),
        })
      ).status
    ).toBe(400);
    expect(server.execute).not.toHaveBeenCalled();
  });

  it('does not read a slow body before unauthenticated rejection', async () => {
    const server = await start();
    server.getUser.mockResolvedValue({
      data: { user: { id: '' } },
      error: null,
    });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${server.origin}/cancel`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': '100',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode);
            request.destroy();
          });
        }
      );
      request.on('error', reject);
      request.flushHeaders();
    });
    expect(status).toBe(401);
    expect(server.execute).not.toHaveBeenCalled();
  });

  it('bounds stalled bodies and redacts dependency failures', async () => {
    const server = await start();
    const headers = await bootstrapHeaders(server.origin);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        `${server.origin}/cancel`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-length': '100',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode);
            request.destroy();
          });
        }
      );
      request.on('error', reject);
      request.write('{');
    });
    expect(status).toBe(400);
    server.createRlsClient.mockRejectedValue(
      new Error('private synthetic sentinel')
    );
    const response = await fetch(
      `${server.origin}/recovery?goalId=${server.goalId}`
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sentinel');
  });

  it('discards late authentication after a real HTTP client abort without executing SQL', async () => {
    const server = await start();
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    server.createRlsClient.mockImplementationOnce(async (request) => {
      request.signal.addEventListener('abort', () => aborted.resolve(), {
        once: true,
      });
      entered.resolve();
      await release.promise;
      return server.client;
    });
    const controller = new AbortController();
    const fetching = fetch(
      `${server.origin}/recovery?goalId=${server.goalId}`,
      { signal: controller.signal }
    );
    const rejected = expect(fetching).rejects.toThrow();
    await entered.promise;
    controller.abort();
    await rejected;
    await aborted.promise;
    release.resolve();
    await server.close();
    expect(server.execute).not.toHaveBeenCalled();
  });

  it('returns a bounded generic failure when the supplied authentication factory stalls', async () => {
    const server = await start();
    server.createRlsClient.mockImplementationOnce(() => new Promise(() => {}));
    const response = await fetch(
      `${server.origin}/recovery?goalId=${server.goalId}`
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Local savings runtime unavailable',
    });
    expect(server.execute).not.toHaveBeenCalled();
  }, 12000);
});
