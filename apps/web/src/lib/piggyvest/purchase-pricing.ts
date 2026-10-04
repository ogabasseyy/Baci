import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  asSavingsDeviceQueryClient,
  readSavingsDeviceProduct,
  resolveSavingsDeviceSelection,
} from '@/lib/customer-savings-device';
import { purchasePricingSchemas as schemas } from '@/schemas/purchase-pricing';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import type { createPurchasePreparation } from './purchase-preparation';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';

export function createAuthenticatedPurchasePricing(options: {
  supabase: SupabaseClient;
  goalId: string;
  configuration: unknown;
  execute: Parameters<typeof createPurchasePreparation>[0]['execute'];
}) {
  return {
    async publish(input: unknown) {
      try {
        const auth = await options.supabase.auth.getUser();
        const actor = schemas.actor.safeParse(auth.data?.user);
        if (auth.error || !actor.success) throw new Error('Unavailable');
        const actorId = actor.data.id;
        const request = schemas.input.parse(input);
        const resolve = () =>
          resolvePiggyvestCustomerPolicyContext({
            supabase: options.supabase,
            configuration: options.configuration,
            input: { goalId: options.goalId },
          });
        const context = await resolve();
        if (context.status !== 'ready' || context.actorId !== actorId)
          throw new Error('Unavailable');
        const scope = context.configuration;
        const goalRead = await options.supabase
          .from('customer_savings_goals')
          .select('id, merchant_id, customer_id, product_id, variant_id')
          .eq('id', scope.goalId)
          .eq('merchant_id', scope.merchantId)
          .eq('customer_id', scope.customerId)
          .maybeSingle();
        if (goalRead.error) throw new Error('Unavailable');
        const goal = schemas.goal.parse(goalRead.data);
        if (
          goal.id !== scope.goalId ||
          goal.merchant_id !== scope.merchantId ||
          goal.customer_id !== scope.customerId
        )
          throw new Error('Unavailable');
        const product = await readSavingsDeviceProduct({
          merchantId: scope.merchantId,
          productId: goal.product_id,
          supabase: asSavingsDeviceQueryClient(options.supabase),
        });
        if (!product || product.id !== goal.product_id)
          throw new Error('Unavailable');
        const device = resolveSavingsDeviceSelection({
          product,
          variantId: goal.variant_id,
        });
        if (!device.ok || !device.snapshot.condition)
          throw new Error('Unavailable');
        const currentKobo = Math.round(device.cataloguePrice * 100);
        if (
          !Number.isSafeInteger(currentKobo) ||
          currentKobo <= 0 ||
          Math.abs(currentKobo / 100 - device.cataloguePrice) > 1e-9
        )
          throw new Error('Unavailable');
        async function revalidate() {
          const next = await resolve();
          return (
            next.status === 'ready' &&
            next.actorId === actorId &&
            JSON.stringify(next.configuration) === JSON.stringify(scope)
          );
        }
        if (!(await revalidate())) throw new Error('Unavailable');
        const response = await options.execute(
          PURCHASE_PRICING_STATEMENTS.purchasePublish.text,
          [
            scope.integrationId,
            scope.merchantId,
            scope.customerId,
            scope.goalId,
            scope.expectedBusinessId,
            JSON.stringify({
              ...request,
              actorId,
              productId: goal.product_id,
              variantId: goal.variant_id,
              condition: device.snapshot.condition,
              currentKobo,
            }),
          ]
        );
        const result = schemas.rows.parse(response.rows)[0].result;
        if (
          result.quote.quoteId !== request.quoteId ||
          result.shippingRateId !== request.shippingRateId ||
          result.quote.savingsKobo !== request.savingsKobo ||
          result.quote.productId !== goal.product_id ||
          result.quote.variantId !== goal.variant_id ||
          result.quote.condition !== device.snapshot.condition ||
          !(await revalidate())
        )
          throw new Error('Unavailable');
        return result;
      } catch {
        return { status: 'unavailable' } as const;
      }
    },
  };
}
