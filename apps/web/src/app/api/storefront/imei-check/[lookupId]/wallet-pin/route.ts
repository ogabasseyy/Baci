import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createImeiAccessClient } from '@/lib/imei-access';
import { verifyGoalPin } from '@/lib/piggyvest/goal-pin-verify';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readWalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import { readWalletPayPinBinding } from '@/lib/piggyvest/wallet-pay-service';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { chargeWalletPinCustomerLimit } from '@/lib/wallet-pin/wallet-pin-customer-limit';
import { imeiWalletPaySchemas } from '@/schemas/imei-wallet-pay';
import { walletPinVerificationResponse } from './wallet-pin-response';

const NO_STORE = { 'Cache-Control': 'no-store' };

function refuse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE });
}

/**
 * Checks the customer's wallet PIN for one PiggyVest payment of this IMEI
 * lookup and returns a single-use proof. The proof is bound to the amount,
 * purchase and attempt the SERVER issued (readWalletPayPinBinding); the client
 * sends only the operation id and the PIN.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lookupId: string }> }
): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return refuse('Please sign in again.', 'UNAUTHORIZED', 401);
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      refuse('Please refresh and try again.', 'CSRF_FAILED', 403)
    );
  // Per-IP throttle after sign-in and CSRF, as on the pay route; the
  // per-customer PIN budget is charged below (Muse).
  const rate = await checkRateLimit(request);
  if (!rate.allowed)
    return createRateLimitResponse(rate.limit, rate.remaining, rate.resetTime);
  const { lookupId } = await params;
  const parsed = imeiWalletPaySchemas.pinRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success || !z.uuid().safeParse(lookupId).success)
    return refuse('Please enter a valid PIN.', 'INVALID_INPUT', 400);
  try {
    const runtime = readWalletPayRuntime();
    if (!runtime)
      return refuse(
        'Paying from your PiggyVest wallet is not available right now.',
        'PIGGYVEST_PAY_UNAVAILABLE',
        503
      );
    const supabase = auth.supabase;
    const identity = await resolvePrimaryWalletIdentity({
      supabase,
      user: auth.user,
      merchantId: runtime.merchantId,
      forOnboarding: false,
    });
    if (!identity)
      return refuse(
        'Finish setting up your PiggyVest wallet to pay from it.',
        'PIGGYVEST_WALLET_NOT_READY',
        409
      );
    const issued = await readWalletPayPinBinding({
      runtime,
      scope: walletPayScope(runtime, identity),
      operationId: parsed.data.operationId,
    });
    const invalid = () =>
      refuse(
        'This payment is no longer valid. Please start again.',
        'PAYMENT_OPERATION_INVALID',
        409
      );
    if (!issued) return invalid();
    if (
      issued.purchase.purpose !== 'imei_check' ||
      issued.purchase.purchaseRef !== lookupId
    )
      return invalid();
    // The payment must carry the lookup's recorded price: a wrong-price
    // payment never spends the PIN budget or gets a proof (Muse).
    const lookup = await createImeiAccessClient({
      customerId: identity.customerId,
      merchantId: identity.merchantId,
      supabase,
      userId: identity.userId,
    }).readStatus(lookupId);
    if (lookup.error) throw new Error('IMEI lookup read failed');
    const priceNgn = (lookup.data as { amount_ngn?: unknown } | null)
      ?.amount_ngn;
    if (
      priceNgn === undefined ||
      Math.round(Number(priceNgn) * 100) !== issued.binding.amountKobo
    )
      return invalid();
    // Charged only once a real PIN check will happen.
    // Its own budget: IMEI payment attempts never lock the customer out of
    // savings goal PIN checks (Codex P2).
    const limited = await chargeWalletPinCustomerLimit(
      'wallet-pay-verify',
      identity.merchantId,
      identity.userId
    );
    if (limited) return limited;
    const result = await verifyGoalPin({
      rpc: (name, args) => supabase.rpc(name, args),
      userId: identity.userId,
      merchantId: identity.merchantId,
      pin: parsed.data.pin,
      binding: issued.binding,
      now: () => Date.now(),
    });
    return walletPinVerificationResponse(result);
  } catch {
    return refuse(
      'PIN checks are temporarily unavailable.',
      'PIN_UNAVAILABLE',
      503
    );
  }
}
