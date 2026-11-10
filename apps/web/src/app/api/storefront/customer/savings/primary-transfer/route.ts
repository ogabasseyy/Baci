import { type NextRequest, NextResponse } from 'next/server';
import { getPrimaryCustomerSavingsFeatureSettings } from '@/app/api/storefront/customer/savings/customer-savings-feature-settings';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { checkPrimaryWalletSavingsStatus } from '@/lib/piggyvest/primary-wallet-savings-status-runtime';
import { submitPrimaryWalletSavings } from '@/lib/piggyvest/primary-wallet-savings-submission-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Please sign in again.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json(
        { error: 'Please refresh and try again.', code: 'CSRF_FAILED' },
        { status: 403 }
      )
    );
  const parsed = piggyvestPrimarySavingsTransferSchemas.statusRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid contribution request.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  try {
    // Status recovery drains through the recovery runtime when the flags
    // are off so a rollback cannot strand a dispatched transfer as
    // pending; POST below stays strictly behind the enabled flags.
    const runtime =
      readPrimaryWalletSavingsRuntime() ??
      readPrimaryWalletSavingsRecoveryRuntime();
    if (!runtime)
      return NextResponse.json(
        {
          error: 'Savings status is temporarily unavailable.',
          code: 'SAVINGS_NOT_READY',
        },
        { status: 503 }
      );
    // A runtime for a different merchant means this merchant can hold no
    // primary record, so clients may route its stored ids to the legacy rail.
    if (runtime.merchantId !== parsed.data.merchantId)
      return NextResponse.json(
        {
          error: 'Primary savings is not enabled for this merchant.',
          code: 'SAVINGS_MERCHANT_NOT_PRIMARY',
        },
        { status: 409 }
      );
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.merchantId,
      forOnboarding: false,
    });
    if (!identity)
      return NextResponse.json(
        {
          error: 'Please verify your email and complete your profile.',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
        { status: 409 }
      );
    const result = await checkPrimaryWalletSavingsStatus({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      operationId: parsed.data.operationId,
      scope: {
        merchantId: identity.merchantId,
        customerId: identity.customerId,
        userId: identity.userId,
        integrationId: runtime.configuration.integrationId,
        environment: runtime.configuration.environment,
        businessId: runtime.businessId,
      },
    });
    if (result.status === 'not_found')
      return NextResponse.json(
        { error: 'Contribution not found.', code: 'CONTRIBUTION_NOT_FOUND' },
        { status: 404 }
      );
    return NextResponse.json(
      { status: result.status, operationId: parsed.data.operationId },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not confirm your contribution. Refresh its status before trying another payment.',
        code: 'SAVINGS_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Please sign in again.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json(
        { error: 'Please refresh and try again.', code: 'CSRF_FAILED' },
        { status: 403 }
      )
    );
  const parsed = piggyvestPrimarySavingsTransferSchemas.httpRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Please enter a valid savings amount.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  try {
    const runtime = readPrimaryWalletSavingsRuntime();
    if (!runtime || runtime.merchantId !== parsed.data.merchantId)
      return NextResponse.json(
        {
          error: 'Savings transfers are temporarily unavailable.',
          code: 'SAVINGS_NOT_READY',
        },
        { status: 503 }
      );
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.merchantId,
      forOnboarding: false,
    });
    if (!identity)
      return NextResponse.json(
        {
          error: 'Please verify your email and complete your profile.',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
        { status: 409 }
      );
    const features = await getPrimaryCustomerSavingsFeatureSettings({
      supabase: auth.supabase,
      merchantId: identity.merchantId,
      customerId: identity.customerId,
    });
    if (!features.savingsEnabled)
      return NextResponse.json(
        { error: 'Savings is not enabled.', code: 'CUSTOMER_SAVINGS_DISABLED' },
        { status: 403 }
      );
    // Whether a proof is needed is decided by the database at reservation
    // time (merchant PIN checking on or off, replay of a reserved operation),
    // so a merchant without PIN checking keeps funding with no proof.
    const { merchantId: _merchantId, pinProof, ...selection } = parsed.data;
    const result = await submitPrimaryWalletSavings({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      scope: {
        merchantId: identity.merchantId,
        customerId: identity.customerId,
        userId: identity.userId,
        integrationId: runtime.configuration.integrationId,
        environment: runtime.configuration.environment,
        businessId: runtime.businessId,
      },
      request: selection,
      pinProof: pinProof ?? '',
    });
    if (result.status === 'pin_refused' && result.reason === 'missing')
      return NextResponse.json(
        {
          error: 'Please confirm your PIN to continue.',
          code: 'PIN_PROOF_REQUIRED',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    if (result.status === 'pin_refused')
      return NextResponse.json(
        {
          error: 'Please confirm your PIN again to continue.',
          code: 'PIN_PROOF_REFUSED',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    if (result.status === 'insufficient')
      return NextResponse.json(
        {
          error: 'Your confirmed wallet funds cannot cover this contribution.',
          code: 'INSUFFICIENT_FUNDS',
        },
        { status: 409 }
      );
    if (result.status === 'conflict')
      return NextResponse.json(
        {
          error:
            'This contribution could not be matched. Please refresh your savings.',
          code: 'CONTRIBUTION_CONFLICT',
        },
        { status: 409 }
      );
    if (result.status === 'unavailable')
      return NextResponse.json(
        {
          error:
            'Could not confirm the wallet details. Please try again later.',
          code: 'WALLET_UNAVAILABLE',
        },
        { status: 503 }
      );
    return NextResponse.json(
      { status: result.status, operationId: selection.operationId },
      {
        status: result.status === 'confirmed' ? 200 : 202,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not confirm this contribution. Please check its status before trying again.',
        code: 'SAVINGS_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}
