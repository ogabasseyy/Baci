import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createPrimaryWalletCardCheckoutExecutor } from '@/lib/piggyvest/primary-wallet-card-checkout-executor';
import { createPrimaryWalletCardCheckoutProvider } from '@/lib/piggyvest/primary-wallet-card-checkout-provider';
import {
  readPrimaryWalletCardCheckoutRuntime,
  readPrimaryWalletCardCheckoutRuntimeDrain,
} from '@/lib/piggyvest/primary-wallet-card-checkout-runtime';
import { createPrimaryWalletCardCheckoutService } from '@/lib/piggyvest/primary-wallet-card-checkout-service';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';

function error(code: string, status: number) {
  return NextResponse.json(
    {
      error:
        'Primary card funding is unavailable. Please refresh or contact support.',
      code,
    },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function handlePrimaryWalletCardCheckout(
  request: NextRequest,
  action: 'initialize' | 'status'
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return error('UNAUTHORIZED', 401);
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return csrf.response ?? error('CSRF_INVALID', 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('INVALID_INPUT', 400);
  }
  const parsed = (
    action === 'initialize' ? schemas.request : schemas.statusRequest
  ).safeParse(body);
  if (!parsed.success) return error('INVALID_INPUT', 400);
  try {
    // New reservations stop at expiry; status polling drains through the
    // recovery reader so pre-expiry operations still resolve.
    const runtime =
      action === 'initialize'
        ? readPrimaryWalletCardCheckoutRuntime()
        : readPrimaryWalletCardCheckoutRuntimeDrain();
    if (!runtime || runtime.settings.merchantId !== parsed.data.merchantId)
      return error('PRIMARY_CARD_NOT_READY', 503);
    if (!auth.user.email_confirmed_at || !auth.user.email)
      return error('VERIFIED_EMAIL_REQUIRED', 409);
    const { data, error: queryError } = await auth.supabase
      .from('customers')
      .select('id, merchant_id, user_id, email')
      .eq('merchant_id', runtime.settings.merchantId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const identity = schemas.identity.safeParse(data);
    // Initialization binds the checkout email at creation, so the stored
    // address must match the confirmed one. Status recovery binds only the
    // immutable IDs: a customer who changed email after initialize must
    // still poll their unresolved or charged checkout (the service layer
    // deliberately excludes email from identityKeys for the same reason,
    // and the stored address is still compared as provider evidence at
    // the collection boundary).
    if (
      queryError ||
      !identity.success ||
      identity.data.merchant_id !== runtime.settings.merchantId ||
      identity.data.user_id !== auth.user.id ||
      (action === 'initialize' &&
        identity.data.email.toLowerCase() !== auth.user.email.toLowerCase())
    )
      return error('OWNERSHIP_REQUIRED', 403);
    const scope = {
      environment: runtime.settings.environment,
      integrationId: runtime.settings.integrationId,
      merchantId: runtime.settings.merchantId,
      customerId: identity.data.id,
      userId: auth.user.id,
      businessId: runtime.settings.businessId,
      email: auth.user.email.toLowerCase(),
    };
    const service = createPrimaryWalletCardCheckoutService({
      settings: runtime.settings,
      scope,
      execute: createPrimaryWalletCardCheckoutExecutor(runtime),
      provider: createPrimaryWalletCardCheckoutProvider(
        runtime.settings,
        fetch
      ),
    });
    const result =
      action === 'initialize'
        ? await service.initialize(parsed.data)
        : await service.status(
            schemas.statusRequest.parse(parsed.data).operationId
          );
    return NextResponse.json(result, {
      status:
        result.status === 'custody_pending' ||
        result.status === 'init_unknown' ||
        result.status === 'initializing'
          ? 202
          : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return error('PRIMARY_CARD_UNAVAILABLE', 503);
  }
}
