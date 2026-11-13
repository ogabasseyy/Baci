import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { imeiWalletPaySchemas } from '@/schemas/imei-wallet-pay';
import { payImeiWalletPayment } from '../../wallet-pay/pay-imei-wallet-payment';
import { createPayImeiWalletPaymentDeps } from '../../wallet-pay/pay-imei-wallet-payment-deps';

const NO_STORE = { 'Cache-Control': 'no-store' };
const refuse = (error: string, code: string, status: number) =>
  NextResponse.json({ error, code }, { status, headers: NO_STORE });

/**
 * Pay for an IMEI check from the PiggyVest wallet with a PIN proof, and get
 * the result once the payment is confirmed. Re-post with an empty proof to
 * check on a payment that is still pending; that never sends money again.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lookupId: string }> }
): Promise<Response> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return refuse('Please sign in again.', 'UNAUTHORIZED', 401);
  // Throttled like the IMEI check itself: empty-proof re-checks are a poll
  // (Muse).
  const rate = await checkRateLimit(request);
  if (!rate.allowed)
    return createRateLimitResponse(rate.limit, rate.remaining, rate.resetTime);
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      refuse('Please refresh and try again.', 'CSRF_FAILED', 403)
    );
  const { lookupId } = await params;
  const parsed = imeiWalletPaySchemas.payRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success || !z.uuid().safeParse(lookupId).success)
    return refuse('Invalid payment request.', 'INVALID_INPUT', 400);
  try {
    return await payImeiWalletPayment(
      { lookupId, body: parsed.data, auth },
      createPayImeiWalletPaymentDeps({
        supabase: auth.supabase,
        user: auth.user,
      })
    );
  } catch {
    // Never "failed": the payment or lookup may have gone through. The
    // client re-checks with an empty proof; the database decides.
    return refuse(
      'Could not confirm this payment yet. Please check again in a moment.',
      'PAYMENT_STATUS_UNKNOWN',
      503
    );
  }
}
