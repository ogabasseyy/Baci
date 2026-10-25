import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission } from '@/lib/api-permissions';
import {
  getMerchantForApiRequest,
  type MerchantContext,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';

export interface OxygenOrderRow {
  id: string;
  merchant_id: string;
  customer_id: string | null;
}

export interface OxygenCustomerRow {
  id: string;
}

// Structural S-03 input built here WITHOUT importing the policy module (D5):
// only the two routes import it. Routes pass this straight to the decision
// function, so assignability is checked at the call site.
export interface OxygenResolvedPolicyInput {
  merchant: { id: string };
  customer: { id: string } | null;
  order: { id: string; merchantId: string };
  environment: string;
  expectedEnvironment: string;
  policy: { guestInitiationsAllowed: boolean };
  rollout: { newInitiationsEnabled: boolean } | null;
  providerReadiness: { verified: boolean } | null;
}

export type OxygenOrderAccessProof =
  | { proven: true; path: 'customer' | 'staff' }
  | { proven: false };

export type ResolveOxygenOrderContextResult =
  | {
      ok: true;
      order: OxygenOrderRow;
      customerRow: OxygenCustomerRow | null;
      staffCtx: MerchantContext | null;
      s03input: OxygenResolvedPolicyInput;
    }
  | { denied: true };

// Single private env reader for this slice: Vercel value first, Node value as
// fallback, 'development' when neither is set. Both S-03 environment fields
// take this one return, so the pair is equal by construction.
function resolveDeploymentEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
}

// Pure comparison: no I/O, no session id (F1 forbids comparing one to
// order.customer_id, so it is not even a parameter). Customer path first,
// staff path second.
export function proveOxygenOrderAccess(args: {
  order: OxygenOrderRow;
  customerRow: OxygenCustomerRow | null;
  staffCtx: MerchantContext | null;
}): OxygenOrderAccessProof {
  if (
    args.customerRow !== null &&
    args.order.customer_id !== null &&
    args.customerRow.id === args.order.customer_id
  ) {
    return { proven: true, path: 'customer' };
  }
  if (
    args.staffCtx !== null &&
    hasPermission(toUserAccess(args.staffCtx), 'orders', 'edit')
  ) {
    return { proven: true, path: 'staff' };
  }
  return { proven: false };
}

// Performs ALL I/O for order authorization: the order row, the scoped
// customer row, and the merchant-scoped staff context. Order storage faults
// propagate for the route to map to 500; zero rows deny. A missing customer
// row denies only the customer path — staff proof is still attempted.
export async function resolveOxygenOrderContext(
  supabase: SupabaseClient,
  orderId: string,
  sessionUserId: string
): Promise<ResolveOxygenOrderContextResult> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, merchant_id, customer_id')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) {
    throw orderError;
  }
  if (!order) {
    return { denied: true };
  }
  const typedOrder = order as OxygenOrderRow;

  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('merchant_id', typedOrder.merchant_id)
    .eq('user_id', sessionUserId)
    .maybeSingle();
  if (customerError) {
    throw customerError;
  }
  const customerRow = (customerData as OxygenCustomerRow | null) ?? null;

  const staffCtx = await getMerchantForApiRequest(supabase, sessionUserId, {
    requestedMerchantId: typedOrder.merchant_id,
  });

  const proof = proveOxygenOrderAccess({
    order: typedOrder,
    customerRow,
    staffCtx,
  });
  if (!proof.proven) {
    return { denied: true };
  }

  const environment = resolveDeploymentEnvironment();
  return {
    ok: true,
    order: typedOrder,
    customerRow,
    staffCtx,
    s03input: {
      merchant: {
        id:
          proof.path === 'staff' && staffCtx !== null
            ? staffCtx.merchantId
            : typedOrder.merchant_id,
      },
      customer:
        typedOrder.customer_id === null ? null : { id: typedOrder.customer_id },
      order: { id: typedOrder.id, merchantId: typedOrder.merchant_id },
      environment,
      expectedEnvironment: environment,
      policy: { guestInitiationsAllowed: false },
      rollout: { newInitiationsEnabled: false },
      providerReadiness: { verified: false },
    },
  };
}
