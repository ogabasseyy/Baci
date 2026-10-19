import { describe, expect, it, vi } from 'vitest';
import { purchasePricingSchemas } from '@/schemas/purchase-pricing';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { createPurchasePreparation } from './purchase-preparation';
import { createAuthenticatedPurchasePricing } from './purchase-pricing';
import {
  actorId,
  authenticatedReader,
  configuration,
  customerId,
  database,
  goal,
  merchantId,
  query,
} from './purchase-pricing-runtime.fixture';

vi.mock('server-only', () => ({}));
function builder(sequence: number, actor = actorId) {
  return createAuthenticatedPurchasePricing({
    supabase: authenticatedReader(actor),
    configuration: configuration(),
    goalId: goal(sequence),
    execute: createPiggyvestPostgresExecutor(database()),
  });
}
function preparation(sequence: number) {
  return createPurchasePreparation({
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      integrationId: configuration().integrationId,
      merchantId,
      customerId,
      goalId: goal(sequence),
      actorId,
      expectedBusinessId: 'synthetic-business',
    },
    execute: createPiggyvestPostgresExecutor(database()),
  });
}
describe.skipIf(process.env.PIGGYVEST_RUN_PURCHASE_PRICING_RUNTIME !== '1')(
  'authenticated RLS pricing publisher and actual preparation',
  () => {
    it('derives actual variant price, protected price, pickup and VAT before durable preparation', async () => {
      const result = purchasePricingSchemas.result.parse(
        await builder(207).publish({
          quoteId: goal(8207),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
        })
      );
      expect(result).toMatchObject({
        fulfilmentMode: 'pickup',
        taxTreatment: 'exclusive_device',
        includedTaxKobo: 0,
        feePolicyVersion: 'synthetic-explicit-fee-v1',
        quote: {
          currency: 'NGN',
          quantity: 1,
          deviceKobo: 96000,
          deliveryKobo: 1500,
          taxKobo: 7200,
          feeKobo: 50,
          totalKobo: 104750,
          savingsKobo: 97000,
          otherPaymentKobo: 7750,
        },
      });
      const command = {
        operationId: goal(9207),
        accepted: true,
        quote: result.quote,
      };
      const runtime = preparation(207);
      const receipt = await runtime.prepare(command);
      expect(receipt).toMatchObject({
        status: 'purchase_pending',
        fulfilment: 'disabled',
      });
      expect(await runtime.prepare(command)).toEqual(receipt);
    });
    it('fails closed for absent reviewed fee capability and a different authenticated actor', async () => {
      expect(
        await builder(208).publish({
          quoteId: goal(8208),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
        })
      ).toEqual({ status: 'unavailable' });
      expect(
        await builder(208, goal(999)).publish({
          quoteId: goal(8208),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
        })
      ).toEqual({ status: 'unavailable' });
    });
    it('invalidates a published quote when actual catalog changes before reservation', async () => {
      const result = purchasePricingSchemas.result.parse(
        await builder(209).publish({
          quoteId: goal(8209),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
        })
      );
      await query(
        'harness_admin',
        'UPDATE public.product_variants SET price_override=990'
      );
      expect(
        await preparation(209).prepare({
          operationId: goal(9209),
          accepted: true,
          quote: result.quote,
        })
      ).toMatchObject({ status: 'unavailable' });
      const saved = await preparation(207).status({ operationId: goal(9207) });
      expect(saved).toMatchObject({ status: 'purchase_pending' });
      const original = await query(
        'harness_admin',
        'SELECT command FROM piggyvest_purchase_preparation.intents WHERE operation_id=$1',
        [goal(9207)]
      );
      expect(
        await preparation(207).prepare({
          operationId: goal(9207),
          accepted: true,
          quote: original.rows[0].command.quote,
        })
      ).toEqual(saved);
      await query(
        'harness_admin',
        'UPDATE public.product_variants SET price_override=980'
      );
    });
    it('rejects ship-rate selection rather than reusing pickup pricing', async () => {
      await query(
        'harness_admin',
        "UPDATE public.merchant_shipping_rates SET kind='ship'"
      );
      expect(
        await builder(205).publish({
          quoteId: goal(8205),
          shippingRateId: goal(8001),
          savingsKobo: 97000,
        })
      ).toEqual({ status: 'unavailable' });
      await query(
        'harness_admin',
        "UPDATE public.merchant_shipping_rates SET kind='pickup'"
      );
    });
    it('rejects a catalog change between RLS observation and locked publication', async () => {
      const execute = createPiggyvestPostgresExecutor(database());
      const pricing = createAuthenticatedPurchasePricing({
        supabase: authenticatedReader(),
        configuration: configuration(),
        goalId: goal(205),
        execute: async (statement, parameters) => {
          await query(
            'harness_admin',
            'UPDATE public.product_variants SET price_override=990'
          );
          return execute(statement, parameters);
        },
      });
      try {
        expect(
          await pricing.publish({
            quoteId: goal(8305),
            shippingRateId: goal(8001),
            savingsKobo: 97000,
          })
        ).toEqual({ status: 'unavailable' });
        const stored = await query(
          'harness_admin',
          'SELECT count(*)::integer AS count FROM piggyvest_purchase_preparation.quotes WHERE id=$1',
          [goal(8305)]
        );
        expect(stored.rows[0].count).toBe(0);
      } finally {
        await query(
          'harness_admin',
          'UPDATE public.product_variants SET price_override=980'
        );
      }
    });
  }
);
