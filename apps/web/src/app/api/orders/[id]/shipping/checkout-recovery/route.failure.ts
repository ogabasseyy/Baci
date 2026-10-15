import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// Maps recovery RPC/validation failures to responses. Extracted from the
// recovery route to keep that module under the 300-line limit.
export function recoveryFailure(
  error: { message?: string; code?: string } | null
) {
  const message = error?.message ?? '';
  if (message.includes('forbidden'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (message.includes('price_changed'))
    return NextResponse.json(
      {
        error:
          'The fresh quote differs from the shipping fee already paid. This recovery cannot change the paid amount.',
        code: 'SHIPPING_RECOVERY_PRICE_CHANGED',
      },
      { status: 409 }
    );
  if (message.includes('funding_not_ready'))
    return NextResponse.json(
      {
        error:
          'Prepaid shipping funding is not yet available for this order. Verify payment settlement before recovering its quote.',
        code: 'SHIPPING_RECOVERY_FUNDING_NOT_READY',
      },
      { status: 409 }
    );
  if (
    message.includes('expired') ||
    message.includes('stale') ||
    error?.code === '40001' ||
    error?.code === '40P01'
  )
    return NextResponse.json(
      {
        error:
          'This preview expired or the order changed. Review the destination and preview again.',
        code: 'SHIPPING_RECOVERY_STALE',
      },
      { status: 409 }
    );
  // A missing Vault signing secret is a configuration outage, not a caller
  // error: surface it distinctly from authorization failures (42501) so
  // operators can tell misconfiguration apart. Never leaks the secret.
  if (message.includes('shipping_recovery_signing_unavailable')) {
    logger.error({
      message: 'checkout shipping recovery signing unavailable',
      code: error?.code,
    });
    return NextResponse.json(
      {
        error:
          'Shipping recovery signing is temporarily unavailable. Please try again later.',
        code: 'SHIPPING_RECOVERY_SIGNING_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
  if (
    message.includes('unavailable') ||
    message.includes('order_refunded') ||
    message.includes('order_cancelled')
  )
    return NextResponse.json(
      {
        error:
          'This order is no longer eligible for prepaid shipping recovery.',
        code: 'SHIPPING_RECOVERY_UNAVAILABLE',
      },
      { status: 409 }
    );
  console.error('Checkout shipping recovery failed', { code: error?.code });
  return NextResponse.json(
    { error: 'Unable to recover this shipping quote. Please try again.' },
    { status: 500 }
  );
}
