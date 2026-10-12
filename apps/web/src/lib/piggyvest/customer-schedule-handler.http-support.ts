import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

export async function startCustomerScheduleHttpFixture(
  loseWriteResponse = false
) {
  const fixture = scheduleStoreRuntimeFixture(402);
  let lose = loseWriteResponse;
  const execute = vi.fn(
    async (...args: Parameters<typeof fixture.database>) => {
      const result = await fixture.database(...args);
      if (
        lose &&
        args[0] === SCHEDULE_STORE_STATEMENTS.writeScheduleProposal.text
      ) {
        lose = false;
        throw new Error(
          'Synthetic lost committed response: private SQL marker'
        );
      }
      return result;
    }
  );
  const text = 'Synthetic local scheduling terms, no debit permission.';
  const server = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: fixture.goalId,
      context: fixture.options.configuration,
      termsDocument: {
        version: 'synthetic-schedule-http',
        text,
        hash: createHash('sha256').update(text).digest('hex'),
      },
    },
    execute,
    services: { schedule: { enabled: true } },
    createRlsClient: (request) => {
      const synthetic = scheduleStoreRuntimeFixture(402, fixture.database);
      if (request.cookies.get('synthetic-session')?.value !== 'owner')
        synthetic.getUser.mockResolvedValue({
          data: { user: null },
          error: null,
        });
      return Promise.resolve(synthetic.options.supabase);
    },
  });
  const localFetch = (path: string, init?: RequestInit) => {
    const target = new URL(path, server.origin);
    if (target.origin !== server.origin)
      throw new Error('External HTTP prohibited');
    return fetch(target, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  };
  let csrfToken = '';
  let cookie = 'synthetic-session=owner';
  async function bootstrap() {
    const response = await localFetch('/csrf', {
      headers: { cookie, origin: server.origin },
    });
    if (response.status !== 200)
      throw new Error('Synthetic CSRF bootstrap unavailable');
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('csrfToken' in body) ||
      typeof body.csrfToken !== 'string'
    )
      throw new Error('Invalid bootstrap response');
    csrfToken = body.csrfToken;
    const cookies = response.headers.getSetCookie();
    if (!cookies.length) throw new Error('Missing CSRF cookie');
    cookie = [
      'synthetic-session=owner',
      ...cookies.map((value) => value.split(';')[0]),
    ].join('; ');
  }
  function get(operationId?: string) {
    return localFetch(
      `/schedule?goalId=${fixture.goalId}${operationId ? `&operationId=${operationId}` : ''}`,
      {
        headers: { cookie, origin: server.origin },
      }
    );
  }
  function post(body: unknown) {
    return localFetch('/schedule', {
      method: 'POST',
      headers: {
        cookie,
        origin: server.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(body),
    });
  }
  return {
    ...server,
    goalId: fixture.goalId,
    execute,
    bootstrap,
    get,
    post,
    localFetch,
  };
}
