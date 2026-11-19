import { NextResponse } from 'next/server';
import { hasBearerAuthScheme } from '@/lib/api-auth';
import { readOxygenMobileCapabilities } from '@/lib/payments/oxygen/mobile-capabilities';
import type { OxygenRuntimeRpc } from '@/lib/payments/oxygen/runtime-service';
import type { OrderCreateInput } from '@/schemas/orders';

// A mobile bearer request must remain gated even if it supplies a web source.
function isMobileOxygenOrder(
  request: Request,
  paymentMethod: string,
  source: string
) {
  return (
    paymentMethod === 'oxygen' &&
    (source === 'mobile_app' || hasBearerAuthScheme(request))
  );
}

export function rejectMobileOxygenCreditCombination(
  request: Request,
  order: Pick<
    OrderCreateInput,
    | 'payment_method'
    | 'source'
    | 'use_wallet_credit'
    | 'wallet_amount'
    | 'use_savings_credit'
    | 'savings_amount'
  >,
  hasVoucherItem: boolean
): NextResponse | null {
  if (!isMobileOxygenOrder(request, order.payment_method, order.source))
    return null;
  // Checkout may apply a server-validated merchant or loyalty discount.
  // Prize vouchers require a voucher-bearing line and use a separate RPC.
  if (
    !hasVoucherItem &&
    !order.use_wallet_credit &&
    order.wallet_amount === 0 &&
    !order.use_savings_credit &&
    (order.savings_amount ?? 0) === 0
  ) {
    return null;
  }
  return NextResponse.json(
    {
      code: 'OXYGEN_MOBILE_COMBINATION_UNSUPPORTED',
      error:
        'Oxygen cannot be combined with vouchers, wallet credit, or savings.',
    },
    { status: 400 }
  );
}

export async function rejectUnavailableMobileOxygenOrder({
  request,
  client,
  merchant,
  userId,
  paymentMethod,
  source,
}: {
  request: Request;
  client: OxygenRuntimeRpc;
  merchant: { id: string; slug: string };
  userId: string | null;
  paymentMethod: string;
  source: string;
}): Promise<NextResponse | null> {
  if (!isMobileOxygenOrder(request, paymentMethod, source)) return null;
  if (!userId) {
    return NextResponse.json(
      { error: 'Sign in to begin an Oxygen application' },
      { status: 401 }
    );
  }
  // Order POST can change the payment method on an idempotent replay.
  // Saved-Oxygen recovery uses the owned workflow read instead.
  const result = await readOxygenMobileCapabilities(client, merchant.slug);
  if (
    result.ok &&
    result.capabilities.mobileEnabled &&
    result.capabilities.merchant.id === merchant.id
  ) {
    return null;
  }
  return NextResponse.json(
    {
      code: 'OXYGEN_MOBILE_UNAVAILABLE',
      error: 'New Oxygen applications are unavailable on this app',
    },
    { status: !result.ok && result.status === 503 ? 503 : 409 }
  );
}
