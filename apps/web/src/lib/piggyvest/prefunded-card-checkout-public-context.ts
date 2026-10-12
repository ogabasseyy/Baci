import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prefundedCardCheckoutPublicContextSchemas as schemas } from '@/schemas/prefunded-card-checkout-public-context';

export async function resolvePrefundedCardCheckoutPublicContext({
  configuration,
  goalId,
  supabase,
}: {
  configuration: unknown;
  goalId: string;
  supabase: SupabaseClient;
}) {
  const unavailable = { status: 'unavailable' } as const;
  try {
    const config = schemas.configuration.safeParse(configuration);
    const goal = schemas.goal.shape.id.safeParse(goalId);
    if (!config.success || !goal.success) return unavailable;
    const auth = await supabase.auth.getUser();
    const actor = schemas.actor.safeParse({
      id: auth.data?.user?.id,
      email: auth.data?.user?.email,
    });
    if (auth.error || !actor.success) return unavailable;
    const merchantResult = await supabase
      .from('merchants')
      .select('id')
      .eq('id', config.data.merchantId)
      .maybeSingle();
    const merchant = schemas.merchant.safeParse(merchantResult.data);
    if (merchantResult.error || !merchant.success) return unavailable;
    const customerResult = await supabase
      .from('customers')
      .select('id, merchant_id, user_id, email')
      .eq('merchant_id', config.data.merchantId)
      .eq('user_id', actor.data.id)
      .maybeSingle();
    const customer = schemas.customer.safeParse(customerResult.data);
    if (
      customerResult.error ||
      !customer.success ||
      customer.data.merchant_id !== config.data.merchantId ||
      customer.data.user_id !== actor.data.id ||
      customer.data.email !== actor.data.email ||
      !config.data.allowlistedCustomerIds.includes(customer.data.id)
    ) {
      return unavailable;
    }
    const goalResult = await supabase
      .from('customer_savings_goals')
      .select('id, merchant_id, customer_id')
      .eq('id', goal.data)
      .eq('merchant_id', config.data.merchantId)
      .eq('customer_id', customer.data.id)
      .maybeSingle();
    const scopedGoal = schemas.goal.safeParse(goalResult.data);
    if (
      goalResult.error ||
      !scopedGoal.success ||
      scopedGoal.data.merchant_id !== config.data.merchantId ||
      scopedGoal.data.customer_id !== customer.data.id
    ) {
      return unavailable;
    }
    return {
      status: 'ready' as const,
      actorId: actor.data.id,
      customerId: customer.data.id,
      email: customer.data.email,
      goalId: scopedGoal.data.id,
    };
  } catch {
    return unavailable;
  }
}
