import 'server-only';
import { NextResponse } from 'next/server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export type WalletPayAnswer =
  | { status: 'pin_refused'; reason: string }
  | { status: string };

export const walletPayRefuse = (error: string, code: string, status: number) =>
  NextResponse.json({ error, code }, { status, headers: NO_STORE });

export const walletPayAccepted = (
  status: string,
  operationId: string,
  extra: Record<string, unknown> = {}
) =>
  NextResponse.json(
    { status, operationId, ...extra },
    { status: 202, headers: NO_STORE }
  );

/**
 * The HTTP answer for every wallet payment outcome except a confirmed one,
 * shared by the products paid from the PiggyVest wallet. `purchase` names
 * what is being paid for ("check", "purchase").
 */
export function walletPayResponse(
  result: WalletPayAnswer,
  operationId: string,
  purchase: string
) {
  if (result.status === 'pin_refused')
    return 'reason' in result && result.reason === 'missing'
      ? walletPayRefuse(
          'Please confirm your PIN to continue.',
          'PIN_PROOF_REQUIRED',
          400
        )
      : walletPayRefuse(
          'Please confirm your PIN again to continue.',
          'PIN_PROOF_REFUSED',
          403
        );
  switch (result.status) {
    case 'insufficient':
      return walletPayRefuse(
        `Your PiggyVest wallet can not cover this ${purchase}.`,
        'INSUFFICIENT_FUNDS',
        409
      );
    case 'pending':
      return walletPayAccepted('payment_pending', operationId);
    case 'needs_review':
      return walletPayAccepted('payment_review', operationId);
    case 'refunding':
      return walletPayAccepted('payment_refunding', operationId);
    case 'released':
    case 'expired':
      return walletPayRefuse(
        'This payment did not go through. Please start again.',
        'PAYMENT_NOT_COMPLETED',
        409
      );
    case 'conflict':
      return walletPayRefuse(
        'Please refresh and try again.',
        'PAYMENT_CONFLICT',
        409
      );
    default:
      return walletPayRefuse(
        'Could not confirm your PiggyVest wallet. Please try again later.',
        'WALLET_UNAVAILABLE',
        503
      );
  }
}
