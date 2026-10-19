import { createHash } from 'node:crypto';
import { createPiggyvestDeviceChangeClient } from '@baci/shared/lib';
import { describe, expect, it, vi } from 'vitest';
import { client } from './customer-purchase-http.fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import {
  authenticatedReader,
  configuration,
  database,
  goal,
  query,
} from './purchase-pricing-runtime.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));
const termsDocument = {
  version: 'synthetic-device',
  text: 'Synthetic device replacement terms.',
  hash: createHash('sha256')
    .update('Synthetic device replacement terms.')
    .digest('hex'),
};
const restarted = process.env.PIGGYVEST_DEVICE_CHANGE_RESTART === '1';
describe.skipIf(process.env.PIGGYVEST_RUN_DEVICE_CHANGE !== '1')(
  'actual device change HTTP and standard restricted PostgreSQL executor',
  () => {
    it.skipIf(restarted)(
      'recovers lost change ACK then prices the actual new public device through RLS and current policy',
      async () => {
        const execute = createPiggyvestPostgresExecutor(database());
        let lose = true;
        const server = await startPiggyvestRuntimeCompositionServer({
          port: 0,
          configuration: {
            mode: 'local_test',
            goalId: goal(205),
            context: configuration(),
            termsDocument,
          },
          createRlsClient: async () => authenticatedReader(),
          services: {
            deviceChange: { enabled: true, termsDocument },
            purchase: { enabled: true },
          },
          execute: async (statement, parameters) => {
            const result = await execute(statement, parameters);
            if (
              lose &&
              statement.includes('piggyvest_device_change.confirm(')
            ) {
              lose = false;
              throw new Error('Synthetic lost committed acknowledgement');
            }
            return result;
          },
        });
        try {
          const call = await client(server.origin);
          const bootstrap = await fetch(`${server.origin}/csrf`, {
            headers: {
              origin: server.origin,
              cookie: 'synthetic-session=customer',
            },
          });
          expect(bootstrap.status).toBe(200);
          const { csrfToken } = await bootstrap.json();
          const cookie = `synthetic-session=customer; ${bootstrap.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ')}`;
          let confirmationStatus: number | undefined;
          const shared = createPiggyvestDeviceChangeClient({
            configuration: {
              mode: 'local_test',
              baseUrl: server.origin,
              endpointPath: '/device-change',
            },
            goalId: goal(205),
            getCsrfToken: async () => csrfToken,
            isCurrent: () => true,
            fetch: async (input, init) => {
              const response = await fetch(input, {
                ...init,
                headers: {
                  ...Object.fromEntries(new Headers(init?.headers)),
                  origin: server.origin,
                  cookie,
                },
              });
              if (String(input).endsWith('/confirm'))
                confirmationStatus = response.status;
              return response;
            },
          });
          const before = await query(
            'harness_admin',
            'SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations WHERE goal_id=$1',
            [goal(205)]
          );
          const publication = await shared.quote({
            goalId: goal(205),
            quoteId: goal(10205),
            productId: '50000000-0000-4000-8000-000000000002',
            variantId: null,
          });
          expect(publication).toMatchObject({
            status: 'quote_available',
            terms: termsDocument,
            quote: { priceKobo: 50000, device: { variant: null } },
          });
          const command = {
            goalId: goal(205),
            operationId: goal(20205),
            quote: publication.quote,
            accepted: true,
          };
          await expect(shared.confirm(command)).rejects.toThrow(
            'Device change unavailable'
          );
          expect(confirmationStatus).toBe(503);
          const historical = await shared.status({
            goalId: goal(205),
            operationId: goal(20205),
          });
          expect(historical).toMatchObject({
            status: 'historical',
            receipt: {
              wallet: 'unchanged',
              balances: 'unchanged',
              revisionId: goal(10205),
            },
          });
          expect(
            await (await call('/device-change/confirm', command)).json()
          ).toEqual(historical.receipt);
          const after = await query(
            'harness_admin',
            'SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations WHERE goal_id=$1',
            [goal(205)]
          );
          expect(after.rows).toEqual(before.rows);
          const screen = await call(`/screen?goalId=${goal(205)}`);
          expect(await screen.json()).toMatchObject({
            status: 'ready',
            policy: {
              revisionId: goal(10205),
              device: {
                productName: 'Synthetic nonvariant device',
                variant: null,
              },
              consent: 'accepted',
            },
          });
          const selection = {
            goalId: goal(205),
            quoteId: goal(40205),
            shippingRateId: goal(8001),
            savingsKobo: 50000,
            fulfilmentMode: 'pickup',
          };
          expect((await call('/purchase/quote', selection)).status).toBe(503);
          await query(
            'harness_admin',
            `INSERT INTO piggyvest_device_change.pricing_capabilities(revision_id,goal_id,fee_policy_version,fee_kobo,tax_treatment,quote_seconds,enabled) VALUES($1,$2,'synthetic-new-device-pickup',0,'not_applicable',300,true)`,
            [goal(10205), goal(205)]
          );
          const purchase = await call('/purchase/quote', selection);
          expect(purchase.status).toBe(200);
          expect(await purchase.json()).toMatchObject({
            quote: {
              revisionId: goal(10205),
              productId: '50000000-0000-4000-8000-000000000002',
              variantId: null,
              deviceKobo: 50000,
              taxKobo: 0,
              deliveryKobo: 1500,
            },
          });
          expect(JSON.stringify(historical)).not.toContain('synthetic-wallet');
          expect(
            (
              await call(
                `/device-change/status?goalId=${goal(204)}&operationId=${goal(20205)}`
              )
            ).status
          ).toBe(403);
        } finally {
          await server.close();
        }
      }
    );
    it.skipIf(!restarted)(
      'reads original durable receipt after PostgreSQL and listener restart without new mutations',
      async () => {
        const execute = createPiggyvestPostgresExecutor(database());
        const server = await startPiggyvestRuntimeCompositionServer({
          port: 0,
          configuration: {
            mode: 'local_test',
            goalId: goal(205),
            context: configuration(),
            termsDocument,
          },
          services: { deviceChange: { enabled: true, termsDocument } },
          createRlsClient: async () => authenticatedReader(),
          execute,
        });
        try {
          const call = await client(server.origin);
          expect(
            await (
              await call(
                `/device-change/status?goalId=${goal(205)}&operationId=${goal(20205)}`
              )
            ).json()
          ).toMatchObject({
            status: 'historical',
            receipt: {
              revisionId: goal(10205),
              wallet: 'unchanged',
              dispatch: 'disabled',
            },
          });
          expect(
            (
              await query(
                'harness_admin',
                'SELECT count(*)::int AS count FROM piggyvest_device_change.replacements WHERE goal_id=$1',
                [goal(205)]
              )
            ).rows[0].count
          ).toBe(1);
        } finally {
          await server.close();
        }
      }
    );
  }
);
