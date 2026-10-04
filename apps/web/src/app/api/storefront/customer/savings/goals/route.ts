import { type NextRequest, NextResponse } from 'next/server';
import {
  getCustomerSavingsFeatureSettings,
  getSavingsIdentifierParams,
  resolveCustomerSavingsContext,
} from '@/app/api/storefront/customer/savings/shared';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  customerSavingsCreateGoalSchema,
  customerSavingsGoalsQuerySchema,
} from '@/schemas/customer-savings';
import {
  prepareCreateSavingsGoalDevice,
  type SavingsProductQueryClient,
} from './prepare-create-savings-goal-device';
import {
  formatSavingsGoal,
  mapSavingsRpcErrorStatus,
  resolveCreateGoalRpcRow,
  type SavingsGoalRow,
  toSavingsRouteNumber,
  toSavingsRpcError,
} from './route-helpers';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const parsed = customerSavingsGoalsQuerySchema.safeParse(
      getSavingsIdentifierParams(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: parsed.error.flatten() },
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

    const { data, error } = await resolved.supabase
      .from('customer_savings_goals')
      .select(
        'id, product_id, variant_id, title, product_snapshot, target_amount, current_amount, initial_contribution_amount, contribution_amount, contribution_frequency, preferred_debit_time, start_date, maturity_date, source_mode, saved_payment_method_id, status, break_fee_percent, metadata, created_at, updated_at, completed_at, future_debits_cancelled_at, cancelled_at, spent_at'
      )
      .eq('merchant_id', resolved.merchant.id)
      .eq('customer_id', resolved.customer.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const goals = ((data ?? []) as SavingsGoalRow[]).map(formatSavingsGoal);
    const savingsBalance = goals.reduce(
      (total, goal) =>
        goal.status === 'active' ||
        goal.status === 'paused' ||
        goal.status === 'completed'
          ? total + goal.currentAmount
          : total,
      0
    );
    const activeGoalCount = goals.filter(
      (goal) => goal.status === 'active'
    ).length;

    return NextResponse.json({
      goals,
      summary: {
        activeGoalCount,
        savingsBalance,
      },
    });
  } catch (error) {
    console.error('Failed to fetch savings goals', error);
    return NextResponse.json(
      { error: 'Failed to fetch savings goals' },
      { status: 500 }
    );
  }
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
        {
          code: 'MALFORMED_JSON',
          error: 'Malformed JSON',
        },
        { status: 400 }
      );
    }

    const parsed = customerSavingsCreateGoalSchema.safeParse(body);
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

    if (
      parsed.data.sourceMode === 'auto_debit' &&
      !featureSettings.autoDebitEnabled
    ) {
      return NextResponse.json(
        {
          code: 'CUSTOMER_SAVINGS_AUTO_DEBIT_DISABLED',
          error: 'Customer savings auto-debit is not enabled',
        },
        { status: 403 }
      );
    }

    const productQueryClient: SavingsProductQueryClient = {
      from: (table) => ({
        select: (columns) => {
          const query = resolved.supabase.from(table).select(columns);
          const chain = {
            eq: (column: string, value: string) => {
              query.eq(column, value);
              return chain;
            },
            maybeSingle: async () => {
              const { data, error } = await query.maybeSingle();
              return { data, error };
            },
          };
          return chain;
        },
      }),
    };
    const deviceResult = await prepareCreateSavingsGoalDevice({
      merchantId: resolved.merchant.id,
      productId: parsed.data.productId,
      supabase: productQueryClient,
      targetAmount: parsed.data.targetAmount,
      variantId: parsed.data.variantId,
    });
    if ('response' in deviceResult) {
      return deviceResult.response;
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await resolved.supabase.rpc(
      'create_customer_savings_goal',
      {
        p_auto_debit_authorized_at:
          parsed.data.sourceMode === 'auto_debit'
            ? nowIso
            : parsed.data.autoDebitAuthorized
              ? nowIso
              : null,
        p_break_fee_percent: parsed.data.breakFeePercent ?? 0,
        p_contribution_amount: parsed.data.contributionAmount,
        p_contribution_frequency: parsed.data.contributionFrequency,
        p_customer_id: resolved.customer.id,
        p_early_end_fee_accepted_at: parsed.data.earlyEndFeeAccepted
          ? nowIso
          : null,
        p_initial_contribution_amount: parsed.data.initialContributionAmount,
        p_initial_contribution_idempotency_key:
          parsed.data.initialContributionIdempotencyKey ?? '',
        p_maturity_date: parsed.data.maturityDate,
        p_merchant_id: resolved.merchant.id,
        p_metadata: parsed.data.metadata ?? {},
        p_non_withdrawable_accepted_at: nowIso,
        p_preferred_debit_time: parsed.data.preferredDebitTime ?? null,
        p_product_id: parsed.data.productId,
        p_product_snapshot: deviceResult.device.snapshot,
        p_saved_payment_method_id: parsed.data.savedPaymentMethodId ?? null,
        p_source_mode: parsed.data.sourceMode,
        p_start_date: parsed.data.startDate,
        p_target_amount: deviceResult.device.targetAmount,
        p_terms_accepted_at: nowIso,
        p_title: parsed.data.title ?? 'Device savings goal',
        p_variant_id: deviceResult.device.variantId,
      }
    );

    if (error) {
      const rpcError = toSavingsRpcError(error);
      const status = mapSavingsRpcErrorStatus(
        rpcError?.message ?? '',
        rpcError?.code
      );
      if (status === 500) {
        console.error('Failed to create savings goal', error);
      }
      return NextResponse.json(
        {
          code: rpcError?.code ?? 'SAVINGS_CREATE_FAILED',
          error:
            status === 500
              ? 'Failed to create savings goal'
              : (rpcError?.message ?? 'Failed to create savings goal'),
        },
        { status }
      );
    }

    const row = resolveCreateGoalRpcRow(data);
    if (!row) {
      return NextResponse.json(
        { error: 'Failed to create savings goal' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      contributionAmount: parsed.data.contributionAmount,
      contributionFrequency: parsed.data.contributionFrequency,
      contributionId: row.contribution_id,
      currentAmount: toSavingsRouteNumber(row.current_amount),
      goalId: row.goal_id,
      goalStatus: row.goal_status,
      success: row.success,
      walletBalance: toSavingsRouteNumber(row.wallet_balance),
    });
  } catch (error) {
    console.error('Failed to create savings goal', error);
    return NextResponse.json(
      { error: 'Failed to create savings goal' },
      { status: 500 }
    );
  }
}
