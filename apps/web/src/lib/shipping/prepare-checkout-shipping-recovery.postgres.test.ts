import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { prepareCheckoutShippingRecovery } from './prepare-checkout-shipping-recovery';

const orderId = '40000000-0000-4000-8000-000000000001';
const merchantId = '10000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
function json(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}
describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'fixed-action recovery signing PostgreSQL boundary',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    function asOwner(sql: string) {
      return database.query(
        `BEGIN; SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT set_config('request.jwt.claim.sub','${ownerId}',true); SET LOCAL ROLE authenticated; ${sql} ROLLBACK;`
      );
    }
    it('stages and confirms a builder-shaped request without embedded merchantId', async () => {
      const fingerprint =
        asOwner(
          `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}')->>'fingerprint';`
        )
          .trim()
          .split('\n')
          .at(-1) ?? '';
      const quoteId = randomUUID();
      const client = {
        rpc: async (name: string, params: Record<string, unknown>) => {
          expect(name).toBe('prepare_customer_checkout_shipping_recovery');
          const output = asOwner(
            `SELECT public.prepare_customer_checkout_shipping_recovery('${orderId}','${fingerprint}',${json(params.p_quote)},${json(params.p_route_proof)}); SELECT public.confirm_customer_checkout_shipping_recovery('${orderId}','${quoteId}',true); RESET ROLE; SELECT shipping_funding_source, shipping_fee, shipping_platform_retained_amount,shipping_provider_cost,shipment_id IS NULL FROM public.orders WHERE id='${orderId}';`
          );
          expect(output).toContain('"confirmed": true');
          expect(output).toContain('customer_checkout|110|110|90|t');
          return { data: quoteId, error: null };
        },
      };
      await expect(
        prepareCheckoutShippingRecovery(client as never, {
          orderId,
          merchantId,
          fingerprint,
          paidShippingFee: 110,
          quote: {
            id: quoteId,
            provider: 'GIGL',
            serviceTier: 'standard',
            carrierName: 'GIG Logistics',
            displayName: 'GIG',
            estimatedDays: 2,
            price: 110,
            providerCost: 100,
            platformMargin: 10,
            marginBasisPoints: 1000,
            pricingVersion: 'gigl_platform_margin_v1',
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            expiresAt: new Date(Date.now() + 3600000),
          },
          quoteRequest: {
            sessionId: orderId,
            shipmentType: 'domestic',
            receiver: {
              name: 'Test Customer',
              phone: '08000000000',
              address: '12 Test Street',
              city: 'Ikeja',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
              latitude: 6.6018,
              longitude: 3.3515,
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 1000 }],
          },
        })
      ).resolves.toEqual({ data: quoteId, error: null });
    });
  }
);
