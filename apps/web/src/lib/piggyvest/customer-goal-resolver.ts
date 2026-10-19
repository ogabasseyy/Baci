import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { piggyvestCustomerGoalSchemas as schemas } from '@/schemas/piggyvest-customer-goal';

type PersistenceGap =
  | 'versioned_policy_consent'
  | 'integration_binding'
  | 'lifecycle_and_price_contract'
  | 'exact_device_snapshot'
  | 'legacy_consent_record';
type Result =
  | {
      status: 'unavailable';
      reason: 'unauthorized' | 'invalid_scope' | 'not_found' | 'read_error';
    }
  | {
      status: 'needs_migration';
      goalId: string;
      reasons: PersistenceGap[];
      device?: {
        productId: string;
        variantId: string | null;
        productName: string;
        variant: string | null;
        condition: string;
      };
    };

export async function resolvePiggyvestCustomerGoal({
  configuration,
  scope,
  supabase,
}: {
  configuration: unknown;
  scope: unknown;
  supabase: SupabaseClient;
}): Promise<Result> {
  try {
    const auth = await supabase.auth.getUser();
    const actor = schemas.actor.safeParse(auth.data?.user);
    if (auth.error || !actor.success)
      return { status: 'unavailable', reason: 'unauthorized' };
    const config = schemas.configuration.safeParse(configuration);
    const identity = schemas.scope.safeParse(scope);
    if (
      !config.success ||
      !identity.success ||
      !config.data.allowlistedCustomerIds.includes(identity.data.customerId)
    ) {
      return { status: 'unavailable', reason: 'invalid_scope' };
    }
    const { merchantId } = config.data;
    const { customerId, goalId } = identity.data;
    const merchantResult = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .maybeSingle();
    if (merchantResult.error)
      return { status: 'unavailable', reason: 'read_error' };
    const merchant = schemas.merchant.safeParse(merchantResult.data);
    if (!merchant.success || merchant.data.id !== merchantId)
      return { status: 'unavailable', reason: 'not_found' };
    const customerResult = await supabase
      .from('customers')
      .select('id, merchant_id, user_id')
      .eq('id', customerId)
      .eq('merchant_id', merchantId)
      .eq('user_id', actor.data.id)
      .maybeSingle();
    if (customerResult.error)
      return { status: 'unavailable', reason: 'read_error' };
    const customer = schemas.customer.safeParse(customerResult.data);
    if (
      !customer.success ||
      customer.data.id !== customerId ||
      customer.data.merchant_id !== merchantId ||
      customer.data.user_id !== actor.data.id
    ) {
      return { status: 'unavailable', reason: 'not_found' };
    }
    const goalResult = await supabase
      .from('customer_savings_goals')
      .select(
        'id, merchant_id, customer_id, product_id, variant_id, status, product_snapshot, terms_accepted_at, non_withdrawable_accepted_at, early_end_fee_accepted_at'
      )
      .eq('id', goalId)
      .eq('customer_id', customerId)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (goalResult.error)
      return { status: 'unavailable', reason: 'read_error' };
    const parsed = schemas.row.safeParse(goalResult.data);
    if (
      !parsed.success ||
      parsed.data.id !== goalId ||
      parsed.data.merchant_id !== merchantId ||
      parsed.data.customer_id !== customerId
    ) {
      return { status: 'unavailable', reason: 'not_found' };
    }
    const row = parsed.data;
    const reasons: PersistenceGap[] = [
      'versioned_policy_consent',
      'integration_binding',
      'lifecycle_and_price_contract',
    ];
    if (!schemas.legacyConsent.safeParse(row).success)
      reasons.push('legacy_consent_record');
    const snapshot = schemas.snapshot.safeParse(row.product_snapshot);
    if (!snapshot.success || snapshot.data.variantId !== row.variant_id) {
      return {
        status: 'needs_migration',
        goalId,
        reasons: [...reasons, 'exact_device_snapshot'],
      };
    }
    return {
      status: 'needs_migration',
      goalId,
      reasons,
      device: {
        productId: row.product_id,
        variantId: row.variant_id,
        productName: snapshot.data.name,
        variant: snapshot.data.variantLabel,
        condition: snapshot.data.condition,
      },
    };
  } catch {
    return { status: 'unavailable', reason: 'read_error' };
  }
}
