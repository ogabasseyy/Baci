import { type NextRequest, NextResponse } from 'next/server';
import {
  getCustomerSavingsFeatureSettings,
  resolveCustomerSavingsContext,
} from '@/app/api/storefront/customer/savings/shared';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  asSavingsDeviceQueryClient,
  readSavingsDeviceProduct,
  resolveSavingsDeviceSelection,
} from '@/lib/customer-savings-device';
import { customerSavingsGoalDeviceSwapSchema } from '@/schemas/customer-savings';
import {
  mapSavingsRpcErrorStatus,
  toSavingsRouteNumber,
  toSavingsRpcError,
} from '../route-helpers';

function readDeviceSwapRpcRow(data: unknown) {
  const row = Array.isArray(data) ? data[0] : null;
  if (typeof row !== 'object' || row === null) {
    return null;
  }

  const record = row as Record<string, unknown>;
  return typeof record.goal_id === 'string' &&
    typeof record.goal_status === 'string' &&
    typeof record.success === 'boolean'
    ? record
    : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: 'MALFORMED_JSON', error: 'Malformed JSON' },
        { status: 400 }
      );
    }

    const parsed = customerSavingsGoalDeviceSwapSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const resolved = await resolveCustomerSavingsContext({
      identifiers: parsed.data,
      supabase: auth.supabase,
      user: auth.user,
    });
    if ('response' in resolved) {
      return resolved.response;
    }

    const featureSettings = await getCustomerSavingsFeatureSettings({
      customerId: resolved.customer.id,
      merchantId: resolved.merchant.id,
      supabase: resolved.supabase,
    });
    if (!featureSettings.savingsEnabled) {
      return NextResponse.json(
        {
          code: 'CUSTOMER_SAVINGS_DISABLED',
          error: 'Customer savings is not enabled for this merchant',
        },
        { status: 403 }
      );
    }

    const product = await readSavingsDeviceProduct({
      merchantId: resolved.merchant.id,
      productId: parsed.data.productId,
      supabase: asSavingsDeviceQueryClient(resolved.supabase),
    });
    if (!product) {
      return NextResponse.json(
        {
          code: 'SAVINGS_DEVICE_PRODUCT_NOT_FOUND',
          error: 'Savings device is not available',
        },
        { status: 404 }
      );
    }

    const device = resolveSavingsDeviceSelection({
      product,
      variantId: parsed.data.variantId,
    });
    if (!device.ok) {
      return NextResponse.json(
        { code: device.code, error: device.error },
        { status: device.status }
      );
    }

    const { data, error } = await resolved.supabase.rpc(
      'swap_customer_savings_goal_device',
      {
        p_actor_id: auth.user.id,
        p_customer_id: resolved.customer.id,
        p_goal_id: parsed.data.goalId,
        p_merchant_id: resolved.merchant.id,
        p_product_id: product.id,
        p_product_snapshot: device.snapshot,
        p_target_amount: device.targetAmount,
        p_title: product.name,
        p_variant_id: device.variantId,
      }
    );

    if (error) {
      const rpcError = toSavingsRpcError(error);
      const status = mapSavingsRpcErrorStatus(
        rpcError?.message ?? '',
        rpcError?.code
      );
      if (status === 500) {
        console.error('Failed to swap savings device', error);
      }
      return NextResponse.json(
        {
          code: rpcError?.code ?? 'SAVINGS_DEVICE_SWAP_FAILED',
          error:
            status === 500
              ? 'Failed to swap savings device'
              : (rpcError?.message ?? 'Failed to swap savings device'),
        },
        { status }
      );
    }

    const row = readDeviceSwapRpcRow(data);
    if (!row) {
      return NextResponse.json(
        { error: 'Failed to swap savings device' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      currentAmount: toSavingsRouteNumber(row.current_amount),
      goalId: row.goal_id,
      goalStatus: row.goal_status,
      success: row.success,
      targetAmount: toSavingsRouteNumber(row.target_amount),
    });
  } catch (error) {
    console.error('Failed to swap savings device', error);
    return NextResponse.json(
      { error: 'Failed to swap savings device' },
      { status: 500 }
    );
  }
}
