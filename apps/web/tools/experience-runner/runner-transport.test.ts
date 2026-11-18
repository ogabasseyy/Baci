import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createRunnerExecutor,
  createRunnerHandler,
  runnerEndpoint,
} from './runner-transport';

const key = new Uint8Array(32).fill(7);
const toolchainDigest = 'a'.repeat(64);
const endpoint = 'https://runner.baci-test.net/v1/execute';
const now = () => 100000;
function setup() {
  const execute = vi.fn(async (_kind: string, payload: unknown) => ({
    output: { compiled: payload },
    wallMs: 1,
    jobId: 'synthetic-job',
  }));
  const handler = createRunnerHandler({ key, toolchainDigest, now, execute });
  const requests: Request[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init);
    requests.push(request.clone());
    return handler(request);
  });
  return {
    execute,
    handler,
    requests,
    transport,
    run: createRunnerExecutor({
      endpoint,
      key,
      toolchainDigest,
      now,
      fetch: transport,
    }),
  };
}
describe('trusted runner control plane', () => {
  it('reserves owner capacity while distinct public renders are in flight', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let publicStarted = 0;
    let publicRejected = false;
    let firstStarted!: () => void;
    let secondObserved!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      secondObserved = resolve;
    });
    const handler = createRunnerHandler({
      key,
      toolchainDigest,
      now,
      execute: async (kind) => {
        if (kind === 'prerender') {
          publicStarted++;
          if (publicStarted === 1) firstStarted();
          else secondObserved();
          await pending;
        }
        return { output: { passed: true }, wallMs: 1, jobId: 'synthetic' };
      },
    });
    const transport: typeof fetch = (url, init) =>
      handler(new Request(url, init));
    const publicSettings = {
      endpoint,
      key,
      toolchainDigest,
      now,
      fetch: transport,
      lane: 'public-render' as const,
    };
    const publicRun = createRunnerExecutor(publicSettings);
    const ownerRun = createRunnerExecutor({
      endpoint,
      key,
      toolchainDigest,
      now,
      fetch: transport,
    });
    const first = publicRun('prerender', {});
    let second: ReturnType<typeof publicRun> | undefined;
    try {
      await firstReady;
      second = publicRun('prerender', {});
      void second.catch(() => {
        publicRejected = true;
        secondObserved();
      });
      await secondReady;
      expect((await ownerRun('compile', {})).output).toEqual({ passed: true });
      expect(publicStarted).toBe(1);
      expect(publicRejected).toBe(true);
    } finally {
      release();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
    }
  });
  it('tolerates independent runner clocks within the explicit skew allowance', async () => {
    const execute = vi.fn(async () => ({
      output: { passed: true },
      wallMs: 1,
      jobId: 'synthetic',
    }));
    const handler = createRunnerHandler({
      key,
      toolchainDigest,
      now: () => now() - 1000,
      execute,
    });
    const run = createRunnerExecutor({
      endpoint,
      key,
      toolchainDigest,
      now,
      fetch: (url, init) => handler(new Request(url, init)),
    });
    expect((await run('compile', {})).output).toEqual({ passed: true });
    expect(execute).toHaveBeenCalledOnce();
  });
  it('executes signed source envelopes, pins toolchain, and refuses replay', async () => {
    const s = setup();
    expect(await s.run('compile', { source: 'export default 1' })).toEqual({
      output: { compiled: { source: 'export default 1' } },
      wallMs: 1,
      jobId: 'synthetic-job',
    });
    expect(s.execute).toHaveBeenCalledOnce();
    expect(s.transport.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect((await s.handler(s.requests[0])).status).toBe(409);
    expect(s.execute).toHaveBeenCalledOnce();
  });
  it('rejects tampered requests and responses without exposing worker errors', async () => {
    const s = setup();
    await s.run('compile', {});
    const request = s.requests[0];
    expect(
      (
        await s.handler(
          new Request(endpoint, {
            method: 'POST',
            headers: request.headers,
            body: '{}',
          })
        )
      ).status
    ).toBe(401);
    const run = createRunnerExecutor({
      endpoint,
      key,
      toolchainDigest,
      now,
      fetch: async () => new Response('{"nonce":"fake","output":{}}'),
    });
    await expect(run('compile', {})).rejects.toThrow('INVALID_RUNNER_RESPONSE');
  });
  it.each([
    { expiresAt: 100000 },
    { expiresAt: 190001 },
    { toolchainDigest: 'b'.repeat(64) },
    { kind: 'shell', payload: { command: 'echo nope' } },
    { lane: 'public-render', kind: 'compile' },
    { lane: 'unknown' },
  ])('rejects expired, unbounded, wrong-image and unknown-program requests: %j', async (patch) => {
    const s = setup();
    const body = JSON.stringify({
      version: 1,
      lane: 'owner',
      nonce: 'c'.repeat(64),
      expiresAt: 190000,
      toolchainDigest,
      kind: 'compile',
      payload: {},
      ...patch,
    });
    const signature = createHmac('sha256', key)
      .update(`request\n${body}`)
      .digest('hex');
    const response = await s.handler(
      new Request(endpoint, {
        method: 'POST',
        body,
        headers: { 'X-Baci-Runner-Signature': signature },
      })
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(s.execute).not.toHaveBeenCalled();
  });
  it('consumes failed executions so ambiguous failures cannot be replayed', async () => {
    const s = setup();
    s.execute.mockRejectedValueOnce(Error('sensitive worker detail'));
    await expect(s.run('compile', {})).rejects.toThrow('RUNNER_UNAVAILABLE');
    expect((await s.handler(s.requests[0])).status).toBe(409);
  });
  it('bounds input before transport', async () => {
    const s = setup();
    await expect(s.run('compile', 'x'.repeat(8 * 1024 * 1024))).rejects.toThrow(
      'RUNNER_MESSAGE_BUDGET'
    );
    expect(s.transport).not.toHaveBeenCalled();
  });
  it.each([
    'http://runner.test/v1/execute',
    'https://user:secret@runner.test/v1/execute',
    'https://127.0.0.1/v1/execute',
    'https://runner.test/arbitrary',
    'https://runner.test/v1/execute?token=x',
  ])('rejects invalid ingress %s', (url) => {
    expect(() => runnerEndpoint(url)).toThrow();
  });
});

it('admits over 1024 sequential signed requests while retaining replay protection and expiry cleanup', async () => {
  let time = 100000;
  const execute = vi.fn(async () => ({
    output: { ok: true },
    wallMs: 1,
    jobId: 'synthetic',
  }));
  const handler = createRunnerHandler({
    key,
    toolchainDigest,
    now: () => time,
    execute,
  });
  let original: Request | undefined;
  const run = createRunnerExecutor({
    endpoint,
    key,
    toolchainDigest,
    now: () => time,
    fetch: (url, init) => {
      const r = new Request(url, init);
      original ??= r.clone();
      return handler(r);
    },
  });
  for (let i = 0; i < 1100; i++) await run('prerender', {});
  if (!original) throw Error('No signed request');
  expect((await handler(original.clone())).status).toBe(409);
  time += 60001;
  for (let i = 0; i < 1100; i++) await run('prerender', {});
  expect(execute).toHaveBeenCalledTimes(2200);
  expect((await handler(original.clone())).status).toBe(409);
});

it('reserves nonce capacity per lane and reopens expired capacity without forgetting replayed requests', async () => {
  let time = 100000;
  let sequence = 0;
  const handler = createRunnerHandler({
    key,
    toolchainDigest,
    now: () => time,
    execute: async () => ({ ok: true }),
  });
  const send = (
    lane: 'public-render' | 'owner',
    nonce = String(++sequence).padStart(64, '0'),
    expiresAt = time + 60000
  ) => {
    const body = JSON.stringify({
      version: 1,
      lane,
      nonce,
      expiresAt,
      toolchainDigest,
      kind: 'prerender',
      payload: {},
    });
    return handler(
      new Request(endpoint, {
        method: 'POST',
        body,
        headers: {
          'x-baci-runner-signature': createHmac('sha256', key)
            .update(`request\n${body}`)
            .digest('hex'),
        },
      })
    );
  };
  for (let i = 0; i < 4096; i++)
    expect((await send('public-render')).status).toBe(200);
  expect((await send('public-render')).status).toBe(429);
  expect((await send('owner')).status).toBe(200);
  expect((await send('owner', String(1).padStart(64, '0'))).status).toBe(409);
  time += 60001;
  expect((await send('public-render')).status).toBe(200);
});
