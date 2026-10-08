import { type NextRequest, NextResponse } from 'next/server';
import { getCustomerSavingsFeatureSettings } from '@/app/api/storefront/customer/savings/shared';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  readPrimarySavingsProvisioningRuntime,
  runPrimarySavingsProvisioning,
} from '@/lib/piggyvest/primary-savings-provisioning-runtime';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';

async function handle(
  request: NextRequest,
  mode: 'provision' | 'recover'
): Promise<NextResponse> {
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
  const parsed = (
    mode === 'provision' ? schemas.request : schemas.selection
  ).safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid savings wallet request.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  try {
    const runtime = readPrimarySavingsProvisioningRuntime();
    if (!runtime || runtime.onboarding.merchantId !== parsed.data.merchantId)
      return NextResponse.json(
        {
          error: 'Savings wallet setup is unavailable.',
          code: 'SAVINGS_NOT_READY',
        },
        { status: 503 }
      );
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.onboarding.merchantId,
    });
    if (!identity)
      return NextResponse.json(
        {
          error: 'Please verify your email and complete your profile.',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
        { status: 409 }
      );
    const features = await getCustomerSavingsFeatureSettings({
      supabase: auth.supabase,
      merchantId: identity.merchantId,
      customerId: identity.customerId,
    });
    if (!features.savingsEnabled)
      return NextResponse.json(
        { error: 'Savings is not enabled.', code: 'CUSTOMER_SAVINGS_DISABLED' },
        { status: 403 }
      );
    const goal = await auth.supabase
      .from('customer_savings_goals')
      .select(
        'id, merchant_id, customer_id, status, terms_accepted_at, non_withdrawable_accepted_at'
      )
      .eq('id', parsed.data.goalId)
      .eq('merchant_id', identity.merchantId)
      .eq('customer_id', identity.customerId)
      .maybeSingle();
    if (goal.error) throw new Error('Goal lookup unavailable');
    if (
      !goal.data ||
      goal.data.id !== parsed.data.goalId ||
      goal.data.merchant_id !== identity.merchantId ||
      goal.data.customer_id !== identity.customerId
    )
      return NextResponse.json(
        { error: 'Savings goal not found.', code: 'GOAL_NOT_FOUND' },
        { status: 404 }
      );
    if (
      goal.data.status !== 'active' ||
      !goal.data.terms_accepted_at ||
      !goal.data.non_withdrawable_accepted_at
    )
      return NextResponse.json(
        {
          error: 'An active accepted savings goal is required.',
          code: 'GOAL_NOT_ELIGIBLE',
        },
        { status: 409 }
      );
    const result = await runPrimarySavingsProvisioning({
      configuration: runtime,
      scope: {
        merchantId: identity.merchantId,
        customerId: identity.customerId,
        userId: identity.userId,
        integrationId: runtime.onboarding.integrationId,
        businessId: runtime.onboarding.businessId,
        environment: runtime.onboarding.environment,
      },
      goalId: parsed.data.goalId,
      mode,
      interestAccepted:
        mode === 'provision'
          ? schemas.request.parse(parsed.data).interestAccepted
          : undefined,
    });
    if (result.status === 'unavailable')
      throw new Error('Provisioning unavailable');
    if (result.status === 'conflict')
      return NextResponse.json(
        {
          error: 'Savings wallet ownership needs review.',
          code: 'SAVINGS_WALLET_CONFLICT',
          ...result,
        },
        { status: 409 }
      );
    if (result.status === 'not_found')
      return NextResponse.json(
        {
          error: 'Savings wallet setup has not started.',
          code: 'SAVINGS_WALLET_NOT_FOUND',
          ...result,
        },
        { status: 404 }
      );
    return NextResponse.json(
      schemas.response.parse({ ...result, goalId: parsed.data.goalId }),
      {
        status: result.status === 'ready' ? 200 : 202,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          'Could not confirm savings wallet setup. Refresh its status before trying again.',
        code: 'SAVINGS_PROVISIONING_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}

export const POST = (request: NextRequest) => handle(request, 'provision');
export const PATCH = (request: NextRequest) => handle(request, 'recover');
