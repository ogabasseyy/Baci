import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { piggyvestCustomerPolicyContextSchemas as schemas } from '@/schemas/piggyvest-customer-policy-context';

type Scope = {
  environment: 'staging';
  integrationId: string;
  expectedBusinessId: string;
  merchantId: string;
  allowlistedCustomerIds: string[];
};

export async function resolvePiggyvestCustomerScope({
  configuration,
  actorId,
  goalId,
  supabase,
}: {
  configuration: Scope;
  actorId: string;
  goalId: string;
  supabase: SupabaseClient;
}) {
  const unavailable = { status: 'unavailable' } as const;
  try {
    const { merchantId } = configuration;
    const merchantResult = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .maybeSingle();
    if (merchantResult.error) return unavailable;
    const merchant = schemas.merchant.safeParse(merchantResult.data);
    if (!merchant.success || merchant.data.id !== merchantId)
      return unavailable;
    const customerResult = await supabase
      .from('customers')
      .select('id, merchant_id, user_id')
      .eq('merchant_id', merchantId)
      .eq('user_id', actorId)
      .maybeSingle();
    if (customerResult.error) return unavailable;
    const customer = schemas.customer.safeParse(customerResult.data);
    if (
      !customer.success ||
      customer.data.merchant_id !== merchantId ||
      customer.data.user_id !== actorId ||
      !configuration.allowlistedCustomerIds.includes(customer.data.id)
    )
      return unavailable;
    const customerId = customer.data.id;
    const goalResult = await supabase
      .from('customer_savings_goals')
      .select('id, merchant_id, customer_id')
      .eq('id', goalId)
      .eq('merchant_id', merchantId)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (goalResult.error) return unavailable;
    const goal = schemas.goal.safeParse(goalResult.data);
    if (
      !goal.success ||
      goal.data.id !== goalId ||
      goal.data.merchant_id !== merchantId ||
      goal.data.customer_id !== customerId
    )
      return unavailable;
    return {
      status: 'ready' as const,
      actorId,
      configuration: {
        environment: configuration.environment,
        integrationId: configuration.integrationId,
        expectedBusinessId: configuration.expectedBusinessId,
        merchantId,
        customerId,
        goalId,
      },
    };
  } catch {
    return unavailable;
  }
}
