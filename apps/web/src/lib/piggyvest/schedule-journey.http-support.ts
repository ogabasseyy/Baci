import { createHash } from 'node:crypto';
import { piggyvestSavingsScreenSchema } from '@baci/shared/contracts';
import {
  createPiggyvestScheduleClient,
  createPiggyvestScheduleClientBinding,
} from '@baci/shared/lib';
import { vi } from 'vitest';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

export async function startScheduleJourneyFixture(
  prefix: string,
  recoveryOperationId?: string
) {
  const fixture = scheduleStoreRuntimeFixture(403);
  let losePause = false;
  let sequence = 0;
  const execute = vi.fn(
    async (...args: Parameters<typeof fixture.database>) => {
      const result = await fixture.database(...args);
      if (
        losePause &&
        args[0] === SCHEDULE_STORE_STATEMENTS.writeScheduleProposal.text &&
        String(args[1][6]).includes('"action":"pause"')
      ) {
        losePause = false;
        throw new Error('Synthetic lost committed acknowledgement');
      }
      return result;
    }
  );
  const text = 'Synthetic local schedule review only; no debit permission.';
  const server = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: fixture.goalId,
      context: fixture.options.configuration,
      termsDocument: {
        version: 'synthetic-schedule-journey',
        text,
        hash: createHash('sha256').update(text).digest('hex'),
      },
    },
    execute,
    services: { schedule: { enabled: true } },
    createRlsClient: (request) => {
      const synthetic = scheduleStoreRuntimeFixture(403, fixture.database);
      if (request.cookies.get('synthetic-session')?.value !== 'owner')
        synthetic.getUser.mockResolvedValue({
          data: { user: null },
          error: null,
        });
      return Promise.resolve(synthetic.options.supabase);
    },
  });
  let cookie = 'synthetic-session=owner';
  const localFetch: typeof globalThis.fetch = (input, init) => {
    const target = new URL(String(input));
    if (target.origin !== server.origin)
      throw new Error('External HTTP prohibited');
    const headers = new Headers(init?.headers);
    headers.set('cookie', cookie);
    headers.set('origin', server.origin);
    return fetch(target, { ...init, headers });
  };
  try {
    const bootstrap = await localFetch(`${server.origin}/csrf`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (bootstrap.status !== 200) throw new Error('CSRF bootstrap unavailable');
    const body: unknown = await bootstrap.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('csrfToken' in body) ||
      typeof body.csrfToken !== 'string' ||
      !bootstrap.headers.getSetCookie().length
    )
      throw new Error('Invalid CSRF bootstrap');
    const token = body.csrfToken;
    cookie = [
      cookie,
      ...bootstrap.headers.getSetCookie().map((value) => value.split(';')[0]),
    ].join('; ');
    const http = {
      configuration: {
        mode: 'local_test',
        baseUrl: server.origin,
        endpointPath: '/schedule',
        credentials: 'same-origin',
      },
      fetch: localFetch,
      getCsrfToken: async () => token,
    };
    const client = createPiggyvestScheduleClient({
      ...http,
      goalId: fixture.goalId,
      isCurrent: () => true,
    });
    const initial = await client.read();
    const source = piggyvestSavingsScreenSchema.parse({
      environment: 'staging',
      status: 'ready',
      sessionKey: 'synthetic-owner-session',
      goalId: fixture.goalId,
      policy: {
        status: 'draft',
        goalId: fixture.goalId,
        revisionId: initial.revisionId,
        device: {
          productName: 'Synthetic fixture device',
          variant: null,
          condition: 'New',
        },
        terms: { version: 'synthetic-v1', hash: initial.termsHash, text },
        consent: 'accepted',
      },
      eligibility: { status: 'unavailable' },
      funding: { status: 'unavailable' },
      progress: { status: 'unavailable' },
    });
    const binding = await createPiggyvestScheduleClientBinding({
      source,
      tenantKey: 'synthetic-tenant',
      http,
      recoveryOperationId,
      isCurrent: () => true,
      nextOperationId: () =>
        `${prefix}0000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    });
    return {
      ...server,
      source,
      binding,
      client,
      execute,
      loseNextPause() {
        losePause = true;
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
