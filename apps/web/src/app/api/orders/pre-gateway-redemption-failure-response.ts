import { NextResponse } from 'next/server';
import type { recordPreGatewayRedemption } from '@/lib/payments/record-pre-gateway-redemption';

type PreGatewayRedemptionFailure = NonNullable<
  Awaited<ReturnType<typeof recordPreGatewayRedemption>>
>;

interface PreGatewayFailureOrderContext {
  id: string;
  orderNumber?: string | null;
  trackingToken?: unknown;
}

interface PreGatewayFailureWalletContext {
  amountUsed: number;
  newBalance: number;
}

/**
 * Builds the error response returned when persisting committed store-credit
 * deductions onto an order fails before gateway handoff.
 */
export function buildPreGatewayRedemptionFailureResponse(input: {
  failure: PreGatewayRedemptionFailure;
  order?: PreGatewayFailureOrderContext;
  amountDueToGateway?: number;
  wallet?: PreGatewayFailureWalletContext;
}) {
  const { failure, order, amountDueToGateway, wallet } = input;
  const trackingToken =
    order && typeof order.trackingToken === 'string'
      ? order.trackingToken
      : undefined;

  return NextResponse.json(
    {
      error: failure.message,
      code: failure.code,
      ...(order ? { orderId: order.id } : {}),
      ...(order?.orderNumber ? { orderNumber: order.orderNumber } : {}),
      ...(trackingToken ? { trackingToken } : {}),
      ...(amountDueToGateway !== undefined ? { amountDueToGateway } : {}),
      ...(wallet && wallet.amountUsed > 0 ? { wallet } : {}),
    },
    { status: failure.status }
  );
}
