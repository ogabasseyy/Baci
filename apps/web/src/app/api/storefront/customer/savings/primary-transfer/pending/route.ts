import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { recoverPrimaryWalletSavings } from '@/lib/piggyvest/primary-wallet-savings-recovery-runtime';
import { readPrimaryWalletSavingsRecoveryRuntime } from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  const headers = { 'Cache-Control': 'no-store' };
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Please sign in again.', code: 'UNAUTHORIZED' },
      { status: 401, headers }
    );
  const parameters = request.nextUrl.searchParams;
  const parsed =
    piggyvestPrimarySavingsTransferSchemas.recoveryRequest.safeParse(
      Object.fromEntries(parameters)
    );
  if (!parsed.success || parameters.size !== 2)
    return NextResponse.json(
      { error: 'Invalid savings request.', code: 'INVALID_INPUT' },
      { status: 400, headers }
    );
  try {
    // Recovery consults durable storage even when the savings runtime is
    // disabled: only a successful lookup may clear the client's operation
    // context, and "runtime off" must never read as "no operation".
    const runtime = readPrimaryWalletSavingsRecoveryRuntime();
    if (!runtime || runtime.merchantId !== parsed.data.merchantId)
      return NextResponse.json(
        {
          error: 'Savings recovery is temporarily unavailable.',
          code: 'SAVINGS_NOT_READY',
        },
        { status: 503, headers }
      );
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.merchantId,
    });
    if (!identity)
      return NextResponse.json(
        {
          error: 'Please verify your email and complete your profile.',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
        { status: 409, headers }
      );
    const operation = await recoverPrimaryWalletSavings({
      configuration: runtime.configuration,
      goalId: parsed.data.goalId,
      scope: {
        merchantId: identity.merchantId,
        customerId: identity.customerId,
        userId: identity.userId,
        integrationId: runtime.configuration.integrationId,
        environment: runtime.configuration.environment,
        businessId: runtime.businessId,
      },
    });
    return NextResponse.json({ operation }, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not check pending contributions. Refresh before making another payment.',
        code: 'SAVINGS_UNAVAILABLE',
      },
      { status: 503, headers }
    );
  }
}
