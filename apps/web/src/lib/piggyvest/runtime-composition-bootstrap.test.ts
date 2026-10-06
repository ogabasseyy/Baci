// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));
const browserOrigin = 'http://127.0.0.1:4181';
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(
  sequence: 701 | 702,
  cookiePath = `/scenario/${sequence}`
) {
  const fixture = cancellationRecoveryFixture();
  const goalId = `30000000-0000-4000-8000-000000000${sequence}`;
  fixture.rows.customer_savings_goals = {
    id: goalId,
    merchant_id: fixture.options.configuration.merchantId,
    customer_id: fixture.options.configuration.allowlistedCustomerIds[0],
  };
  const server = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    browserOrigin,
    csrfCookiePath: cookiePath,
    configuration: {
      mode: 'local_test',
      goalId,
      context: fixture.options.configuration,
      termsDocument: {
        version: 'synthetic',
        hash: 'a'.repeat(64),
        text: 'Synthetic only',
      },
    },
    createRlsClient: async () => fixture.options.supabase,
    execute: fixture.execute,
  });
  servers.push(server);
  return { ...server, ...fixture };
}

it('rejects cross-goal, path, origin, session, actor, cookie and token replay over actual HTTP', async () => {
  const first = await start(701);
  const second = await start(702);
  const wrongPath = await start(701, '/scenario/702');
  const bootstrap = await fetch(`${first.origin}/csrf`, {
    headers: { origin: browserOrigin, cookie: 'synthetic-session=one' },
  });
  expect(bootstrap.status).toBe(200);
  const { csrfToken } = await bootstrap.json();
  expect(bootstrap.headers.getSetCookie().join(';')).toContain(
    'Path=/scenario/701'
  );
  expect(bootstrap.headers.getSetCookie().join(';')).toContain('HttpOnly');
  const cookie = `synthetic-session=one; ${bootstrap.headers.getSetCookie()[0].split(';')[0]}`;
  const headers = {
    origin: browserOrigin,
    cookie,
    'x-csrf-token': csrfToken,
    'content-type': 'application/json',
  };
  const post = (origin: string, supplied = headers) =>
    fetch(`${origin}/policy`, {
      method: 'POST',
      headers: supplied,
      body: '{}',
    });
  expect((await post(first.origin)).status).toBe(400);
  expect((await post(second.origin)).status).toBe(403);
  expect((await post(wrongPath.origin)).status).toBe(403);
  expect(
    (await post(first.origin, { ...headers, origin: 'http://127.0.0.1:4182' }))
      .status
  ).toBe(403);
  expect(
    (
      await post(first.origin, {
        ...headers,
        cookie: cookie.replace('session=one', 'session=two'),
      })
    ).status
  ).toBe(403);
  expect(
    (
      await post(first.origin, {
        ...headers,
        cookie: 'synthetic-session=one; piggyvest-csrf=unsigned',
      })
    ).status
  ).toBe(403);
  expect(
    (await post(first.origin, { ...headers, 'x-csrf-token': 'unsigned' }))
      .status
  ).toBe(403);
  first.getUser.mockResolvedValue({
    data: { user: { id: first.operationId } },
    error: null,
  });
  expect((await post(first.origin)).status).toBe(403);
  expect(first.execute).not.toHaveBeenCalled();
  expect(second.execute).not.toHaveBeenCalled();
});

it('does not bootstrap without verified auth, allowed origin, fixed path and clean headers', async () => {
  const server = await start(701);
  expect((await fetch(`${server.origin}/csrf`)).status).toBe(403);
  expect(
    (
      await fetch(`${server.origin}/csrf?cookiePath=/`, {
        headers: { origin: browserOrigin },
      })
    ).status
  ).toBe(400);
  expect(
    (
      await fetch(`${server.origin}/csrf`, {
        headers: {
          origin: browserOrigin,
          'x-forwarded-host': '127.0.0.1:4181',
        },
      })
    ).status
  ).toBe(403);
  server.getUser.mockResolvedValue({ data: { user: { id: '' } }, error: null });
  const response = await fetch(`${server.origin}/csrf`, {
    headers: { origin: browserOrigin },
  });
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie()).toEqual([]);
  await expect(start(701, '/scenario/701/../702')).rejects.toThrow();
  await expect(
    start(701, '/scenario/701; Domain=evil.invalid')
  ).rejects.toThrow();
});
