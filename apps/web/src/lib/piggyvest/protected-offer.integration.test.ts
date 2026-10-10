import { createPiggyvestProtectedOfferClient } from '@baci/shared/lib';
import { describe, expect, it, vi } from 'vitest';
import { client, termsDocument } from './customer-purchase-http.fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import {
  authenticatedReader,
  configuration,
  database,
  query,
  goal as syntheticGoal,
} from './purchase-pricing-runtime.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));
const restarted = process.env.PIGGYVEST_PROTECTED_OFFER_RESTART === '1';
const goal = (sequence: number) =>
  sequence === 205
    ? syntheticGoal(sequence).replace('30000000', 'abcdef00')
    : syntheticGoal(sequence);
describe.skipIf(process.env.PIGGYVEST_RUN_PROTECTED_OFFER !== '1')(
  'protected offer real HTTP and restricted PostgreSQL',
  () => {
    it('recovers immutable publication after response loss or process restart and honors it without acknowledgment', async () => {
      const execute = createPiggyvestPostgresExecutor(database());
      let lose = !restarted;
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
          protectedOffer: { enabled: true },
          purchase: { enabled: true },
        },
        execute: async (statement, parameters) => {
          const result = await execute(statement, parameters);
          if (
            lose &&
            statement.includes('protected_offer.publish(') &&
            parameters[6] === 'abcdef12-0000-4000-8000-000000031205'
          ) {
            lose = false;
            throw new Error('Synthetic lost committed response');
          }
          return result;
        },
      });
      try {
        const send = await client(server.origin);
        const bootstrap = await fetch(`${server.origin}/csrf`, {
          headers: { origin: server.origin },
        });
        const { csrfToken } = await bootstrap.json();
        const cookie = bootstrap.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
        const shared = createPiggyvestProtectedOfferClient({
          configuration: {
            mode: 'local_test',
            baseUrl: server.origin,
            endpointPath: '/protected-offer',
          },
          goalId: goal(205),
          isCurrent: () => true,
          getCsrfToken: async () => csrfToken,
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init?.headers)),
                origin: server.origin,
                cookie,
              },
            }),
        });
        const body = { goalId: goal(205), offerId: goal(30205) };
        if (!restarted) {
          await query(
            'harness_admin',
            'UPDATE public.product_variants SET price_override=970'
          );
          expect(await shared.publish(body)).toMatchObject({
            status: 'published',
          });
          await expect(
            shared.publish({
              ...body,
              offerId: 'abcdef12-0000-4000-8000-000000031205',
            })
          ).rejects.toThrow('Protected offer unavailable');
        }
        await query(
          'harness_admin',
          'UPDATE public.product_variants SET price_override=1200'
        );
        const aliasResult = await shared.status({
          ...body,
          offerId: 'abcdef12-0000-4000-8000-000000031205',
        });
        expect(aliasResult).toMatchObject({
          requestedOfferId: 'abcdef12-0000-4000-8000-000000031205',
          receipt: { offerId: body.offerId },
        });
        const recovered = await send(
          `/protected-offer/status?goalId=${body.goalId}&offerId=${body.offerId}`
        );
        expect(recovered.status).toBe(200);
        const original = await recovered.json();
        expect(aliasResult.receipt).toEqual(original.receipt);
        const uppercase = {
          goalId: body.goalId.toUpperCase(),
          offerId: 'ABCDEF12-0000-4000-8000-000000031205',
        };
        const uppercaseRead = await send(
          `/protected-offer/status?goalId=${uppercase.goalId}&offerId=${uppercase.offerId}`
        );
        expect(uppercaseRead.status).toBe(200);
        expect(await uppercaseRead.json()).toMatchObject({
          requestedOfferId: uppercase.offerId.toLowerCase(),
          receipt: original.receipt,
        });
        expect(
          await (await send('/protected-offer/publish', uppercase)).json()
        ).toEqual({ status: 'published', receipt: original.receipt });
        expect(
          await shared.publish({
            ...body,
            offerId: 'abcdef12-0000-4000-8000-000000031205',
          })
        ).toEqual({ status: 'published', receipt: original.receipt });
        expect(original).toMatchObject({
          status: 'observed',
          pricePromise: 'active',
          funds: 'requires_checkout_review',
          receipt: { ...body, priceKobo: 97000 },
        });
        const replay = await send('/protected-offer/publish', body);
        expect(await replay.json()).toEqual({
          status: 'published',
          receipt: original.receipt,
        });
        await query(
          'harness_admin',
          'UPDATE public.product_variants SET price_override=1200'
        );
        const checkout = await send('/purchase/quote', {
          goalId: body.goalId,
          quoteId: goal(restarted ? 39206 : 39205),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
          fulfilmentMode: 'pickup',
        });
        expect(checkout.status).toBe(200);
        expect(await checkout.json()).toMatchObject({
          quote: { deviceKobo: 97000 },
        });
        expect(
          (
            await send(
              `/protected-offer/status?goalId=${goal(206)}&offerId=${body.offerId}`
            )
          ).status
        ).toBe(403);
        const count = await query(
          'harness_admin',
          'SELECT count(*)::int AS count FROM piggyvest_protected_offer.publications WHERE goal_id=$1',
          [body.goalId]
        );
        expect(count.rows[0].count).toBe(1);
      } finally {
        await server.close();
      }
    });
  }
);
