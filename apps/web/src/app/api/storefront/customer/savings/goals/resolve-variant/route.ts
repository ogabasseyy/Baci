import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  asSavingsDeviceQueryClient,
  readSavingsDeviceProduct,
} from '@/lib/customer-savings-device';
import { resolveCustomerSavingsNonpaymentContext } from '@/lib/customer-savings-nonpayment-context';
import { getCustomerSavingsNonpaymentSettings } from '@/lib/customer-savings-nonpayment-settings';
import { isStorefrontProductVariantPublic } from '@/lib/is-storefront-product-variant-public';
import { customerSavingsVariantRecoverySchema } from '@/schemas/customer-savings-variant-recovery';
import { mapSavingsRpcErrorStatus, toSavingsRpcError } from '../route-helpers';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }
    const parsed = customerSavingsVariantRecoverySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const context = await resolveCustomerSavingsNonpaymentContext({
      identifiers: parsed.data,
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in context) return context.response;
    const settings = await getCustomerSavingsNonpaymentSettings({
      customerId: context.customer.id,
      merchantId: context.merchant.id,
      supabase: context.supabase,
    });
    if (!settings.savingsEnabled) {
      return NextResponse.json(
        { error: 'Customer savings is disabled' },
        { status: 403 }
      );
    }
    // The recovery RPC gates only the inventory anchor and the parent
    // product status, so enforce the same storefront-visibility rule as
    // create/swap before invoking it: a retained UUID for a hidden variant
    // must not bind redemption to an inactive or archived device.
    const goalResult = await context.supabase
      .from('customer_savings_goals')
      .select('id, product_id')
      .eq('merchant_id', context.merchant.id)
      .eq('customer_id', context.customer.id)
      .eq('id', parsed.data.goalId)
      .maybeSingle();
    if (goalResult.error) {
      throw goalResult.error;
    }
    const recoveryProductId = goalResult.data?.product_id ?? null;
    if (recoveryProductId) {
      const product = await readSavingsDeviceProduct({
        merchantId: context.merchant.id,
        productId: recoveryProductId,
        supabase: asSavingsDeviceQueryClient(context.supabase),
      });
      const recoveredVariant =
        (product?.variants ?? []).find(
          (variant) => variant.id === parsed.data.variantId
        ) ?? null;
      if (
        !recoveredVariant ||
        !isStorefrontProductVariantPublic(recoveredVariant)
      ) {
        return NextResponse.json(
          {
            code: 'SAVINGS_DEVICE_VARIANT_NOT_FOUND',
            error: 'Savings device variant is not available',
          },
          { status: 404 }
        );
      }
    }
    const { data, error } = await context.supabase.rpc(
      'resolve_completed_customer_savings_goal_variant',
      {
        p_actor_id: auth.user.id,
        p_customer_id: context.customer.id,
        p_merchant_id: context.merchant.id,
        p_goal_id: parsed.data.goalId,
        p_variant_id: parsed.data.variantId,
      }
    );
    if (error) {
      const failure = toSavingsRpcError(error);
      const status =
        failure?.message === 'savings_goal_not_legacy_variant_recoverable'
          ? 409
          : mapSavingsRpcErrorStatus(failure?.message ?? '', failure?.code);
      return NextResponse.json(
        {
          error: 'Unable to confirm this savings variant',
          code:
            status === 409
              ? 'SAVINGS_VARIANT_RECOVERY_CONFLICT'
              : 'SAVINGS_VARIANT_RECOVERY_FAILED',
        },
        { status }
      );
    }
    const row: unknown = Array.isArray(data) ? data[0] : null;
    if (
      typeof row !== 'object' ||
      row === null ||
      !('success' in row) ||
      row.success !== true ||
      !('goal_id' in row) ||
      row.goal_id !== parsed.data.goalId ||
      !('goal_status' in row) ||
      row.goal_status !== 'completed'
    ) {
      return NextResponse.json(
        { error: 'Unable to confirm this savings variant' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      goalId: row.goal_id,
      goalStatus: row.goal_status,
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to confirm this savings variant' },
      { status: 500 }
    );
  }
}
