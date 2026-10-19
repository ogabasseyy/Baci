// @vitest-environment node
import { createHash } from 'node:crypto';
import { piggyvestCancellationReviewSchemas } from '@baci/shared/contracts';
import { createPiggyvestPolicyClient } from '@baci/shared/lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));

const listeners: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});
const termsDocument = {
  version: 'synthetic-http-v1',
  text: 'Synthetic HTTP terms. Not a customer agreement.',
  hash: createHash('sha256')
    .update('Synthetic HTTP terms. Not a customer agreement.')
    .digest('hex'),
};
const operationId = '80000000-0000-4000-8000-000000000302';

async function start(
  sequence: 301 | 302,
  database: PiggyvestProvisioningExecutor
) {
  const goalId = `30000000-0000-4000-8000-000000000${sequence}`;
  const source = cancellationRecoveryFixture();
  const execute = vi.fn(database);
  const server = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId,
      context: source.options.configuration,
      termsDocument,
    },
    execute,
    createRlsClient: async (request) => {
      const synthetic = cancellationRecoveryFixture();
      synthetic.rows.customer_savings_goals = {
        id: goalId,
        merchant_id: source.options.configuration.merchantId,
        customer_id: source.options.configuration.allowlistedCustomerIds[0],
      };
      const session = request.cookies.get('synthetic-session')?.value;
      if (session === 'tenant')
        synthetic.rows.customers = {
          id: source.options.configuration.allowlistedCustomerIds[0],
          merchant_id: '10000000-0000-4000-8000-000000000002',
          user_id: source.actorId,
        };
      const actor =
        session === 'owner' || session === 'tenant'
          ? source.actorId
          : session === 'other'
            ? operationId
            : '';
      synthetic.getUser.mockResolvedValue({
        data: { user: { id: actor } },
        error: null,
      });
      return synthetic.options.supabase;
    },
  });
  listeners.push(server);
  const bootstrap = await fetch(`${server.origin}/csrf`, {
    headers: { origin: server.origin, cookie: 'synthetic-session=owner' },
  });
  expect(bootstrap.status).toBe(200);
  const { csrfToken } = await bootstrap.json();
  const sessionCookie = `synthetic-session=owner; ${bootstrap.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')}`;
  const transport: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', sessionCookie);
    headers.set('origin', server.origin);
    return fetch(input, { ...init, headers });
  };
  return {
    ...server,
    goalId,
    execute,
    transport,
    csrfToken: csrfToken as string,
  };
}

describe.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_COMPOSITION !== '1')(
  'real HTTP handlers and restricted PostgreSQL composition',
  () => {
    const database = () =>
      createPiggyvestPostgresExecutor({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_policy_writer',
        port: 55444,
      });

    it('persists consent independently from financial readiness via the actual shared HTTP client', async () => {
      const server = await start(301, database());
      const client = createPiggyvestPolicyClient({
        configuration: {
          mode: 'local_test',
          baseUrl: server.origin,
          endpointPath: '/policy',
        },
        fetch: server.transport,
        getCsrfToken: async () => server.csrfToken,
      });
      const draft = await client.load(server.goalId);
      expect(draft).toMatchObject({
        status: 'draft',
        device: {
          productName: 'Synthetic phone',
          variant: '256GB',
          condition: 'new',
        },
        terms: termsDocument,
      });
      if (draft.status !== 'draft') throw new Error('Expected synthetic draft');
      if (process.env.PIGGYVEST_RUNTIME_AFTER_RESTART !== '1') {
        expect(draft.consent).toBe('required');
        expect(
          await client.submit({
            goalId: server.goalId,
            revisionId: draft.revisionId,
            termsVersion: draft.terms.version,
            termsHash: draft.terms.hash,
            accepted: true,
          })
        ).toMatchObject({ consent: 'accepted', status: 'draft' });
      } else expect(draft.consent).toBe('accepted');
      expect(
        (
          await server.transport(
            `${server.origin}/cancel?goalId=${server.goalId}`
          )
        ).status
      ).toBe(503);
      expect(
        (
          await server.transport(
            `${server.origin}/funding?goalId=${server.goalId}`
          )
        ).status
      ).toBe(503);
      expect(
        server.execute.mock.calls.every(
          ([statement]) => !statement.includes('prepare(')
        )
      ).toBe(true);
    });

    it('recovers original retained reservation after lost committed response, listener replacement and PostgreSQL restart', async () => {
      const execute = database();
      let loseResponse = process.env.PIGGYVEST_RUNTIME_AFTER_RESTART !== '1';
      const server = await start(302, async (statement, parameters) => {
        const result = await execute(statement, parameters);
        if (
          loseResponse &&
          statement.includes('piggyvest_cancel_plan.prepare(')
        ) {
          loseResponse = false;
          throw new Error('Synthetic lost committed response: private marker');
        }
        return result;
      });
      let command:
        | ReturnType<
            typeof piggyvestCancellationReviewSchemas.confirmation.parse
          >
        | undefined;
      if (process.env.PIGGYVEST_RUNTIME_AFTER_RESTART !== '1') {
        const absent = await server.transport(
          `${server.origin}/recovery?goalId=${server.goalId}`
        );
        expect(await absent.json()).toMatchObject({
          status: 'absent',
          reservation: 'unknown',
          retry: 'not_authorized',
        });
        const response = await server.transport(
          `${server.origin}/cancel?goalId=${server.goalId}`
        );
        expect(response.status).toBe(200);
        const quote = piggyvestCancellationReviewSchemas.quote.parse(
          await response.json()
        );
        if (quote.status !== 'quote_available')
          throw new Error('Expected synthetic quote');
        command = piggyvestCancellationReviewSchemas.confirmation.parse({
          goalId: server.goalId,
          operationId,
          revisionId: quote.revisionId,
          termsVersion: quote.termsVersion,
          termsHash: quote.termsHash,
          consentVersion: quote.consentVersion,
          principalKobo: quote.principalKobo,
          paidInterestKobo: quote.paidInterestKobo,
          pendingInterestKobo: quote.pendingInterestKobo,
          accepted: true,
        });
        const uncertain = await server.transport(`${server.origin}/cancel`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': server.csrfToken,
          },
          body: JSON.stringify(command),
        });
        expect(uncertain.status).toBe(503);
        expect(await uncertain.json()).toEqual({
          status: 'unavailable',
          goalId: server.goalId,
          operationId,
          reservation: 'may_be_retained',
          dispatch: 'contract_gap',
        });
      }
      await server.close();
      const reloaded = await start(302, execute);
      const recovered = await reloaded.transport(
        `${reloaded.origin}/recovery?goalId=${reloaded.goalId}&operationId=${operationId}`
      );
      expect(recovered.status).toBe(200);
      const receipt = await recovered.json();
      expect(receipt).toEqual({
        goalId: reloaded.goalId,
        requestedOperationId: operationId,
        operationId,
        status: 'prepared',
        reservation: 'retained',
        interestDisposition: 'unresolved',
        retry: 'not_authorized',
        dispatch: 'contract_gap',
        originalDisclosure: {
          revisionId: '70000000-0000-4000-8000-000000000302',
          termsVersion: termsDocument.version,
          termsHash: termsDocument.hash,
          consentVersion: '2026-09-11',
          principalKobo: 100,
          paidInterestKobo: 7,
          pendingInterestKobo: 3,
        },
      });
      expect(JSON.stringify(receipt)).not.toMatch(
        /actorId|merchantId|customerId|synthetic-business|password|private marker/
      );
      if (command) {
        const replay = await reloaded.transport(`${reloaded.origin}/cancel`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': reloaded.csrfToken,
          },
          body: JSON.stringify(command),
        });
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({
          status: 'prepared',
          operationId,
          dispatch: 'contract_gap',
        });
      }
      const calls = reloaded.execute.mock.calls.length;
      for (const session of ['', 'other', 'tenant']) {
        const denied = await fetch(
          `${reloaded.origin}/recovery?goalId=${reloaded.goalId}`,
          { headers: { cookie: `synthetic-session=${session}` } }
        );
        expect(denied.status).toBe(session ? 403 : 401);
      }
      for (const path of ['/policy', '/cancel', '/recovery']) {
        expect(
          (
            await reloaded.transport(
              `${reloaded.origin}${path}?goalId=30000000-0000-4000-8000-000000000301`
            )
          ).status
        ).toBe(403);
      }
      expect(reloaded.execute.mock.calls).toHaveLength(calls);
    });
  }
);
