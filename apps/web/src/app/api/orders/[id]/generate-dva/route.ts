import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, getUserAccess } from '@/lib/api-auth';
import { hasPermission } from '@/lib/api-permissions';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { reservePaystackDvaAssignment } from '@/lib/payments/reserve-paystack-dva-assignment';
import { resolveChargeCurrency } from '@/lib/payments/resolve-charge-currency';
import { generatePaymentAccount } from '@/lib/paystack';
import { orderIdParamsSchema } from '@/schemas/orders';
import { loadDvaProvisioningContext } from '../load-dva-provisioning-context';
import {
  getDvaReservationFailureResponse,
  getDvaReservationProofFailureResponse,
} from './generate-dva-reservation-response';
import { isActivePaymentAccount } from './is-active-payment-account';
import { isEligibleOrderForPaystackDva } from './is-eligible-order-for-paystack-dva';
import { isUniqueViolation } from './is-unique-violation';
import { loadLatestLegacyOrderAccount } from './load-latest-legacy-order-account';
import { loadLatestPaystackOrderAccount } from './load-latest-paystack-order-account';
import { toCustomerName } from './to-customer-name';
import { toVirtualAccount } from './to-virtual-account';
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) return response as NextResponse;

    const parsedParams = orderIdParamsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: 'Invalid order ID', code: 'INVALID_ORDER_ID' },
        { status: 400 }
      );
    }
    const orderId = parsedParams.data.id;
    const access = await getUserAccess(auth.supabase);
    const merchantId = access?.merchantId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const supabase = auth.supabase;
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, order_number, total, amount_paid, wallet_amount_used, customer_name, customer_email, customer_phone, payment_status, shipping_status, cancelled_at, currency, merchant_id'
      )
      .eq('id', orderId)
      .eq('merchant_id', merchantId)
      .single();
    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.payment_status === 'paid') {
      return NextResponse.json(
        { error: 'Order is already paid' },
        { status: 400 }
      );
    }
    if (!isEligibleOrderForPaystackDva(order)) {
      return NextResponse.json(
        {
          code: 'ORDER_NOT_ELIGIBLE_FOR_DVA',
          error: 'Order is not eligible for automatic confirmation',
        },
        { status: 400 }
      );
    }
    const currencyResolution = resolveChargeCurrency({
      clientCurrency: null,
      gateway: 'paystack',
      orderCurrency: order.currency,
    });
    if (!currencyResolution.ok) {
      return NextResponse.json(
        {
          code: currencyResolution.code,
          error: currencyResolution.error,
        },
        { status: 400 }
      );
    }
    const customerEmail = order.customer_email?.trim();
    if (!customerEmail) {
      return NextResponse.json(
        {
          code: 'CUSTOMER_EMAIL_REQUIRED',
          error: 'A customer email is required for automatic confirmation',
        },
        { status: 400 }
      );
    }
    const provisioningContext = await loadDvaProvisioningContext({
      merchantId,
      orderId,
      supabase,
    });
    if (!provisioningContext.ok) {
      return NextResponse.json(
        { code: provisioningContext.code, error: provisioningContext.error },
        { status: provisioningContext.status }
      );
    }
    const { data: existingVba, error: existingVbaError } =
      await loadLatestPaystackOrderAccount(supabase, orderId);

    if (existingVbaError) {
      return NextResponse.json(
        { error: 'Failed to verify existing payment account' },
        { status: 500 }
      );
    }
    if (existingVba && isActivePaymentAccount(existingVba)) {
      return NextResponse.json({
        success: true,
        virtualAccount: toVirtualAccount(existingVba),
        existing: true,
      });
    }
    const { data: existingLegacyAccount, error: existingLegacyError } =
      await loadLatestLegacyOrderAccount(supabase, orderId);

    if (existingLegacyError) {
      logger.error({
        message: 'Database error checking legacy payment account',
        error: existingLegacyError,
      });
      return NextResponse.json(
        { error: 'Failed to verify existing payment account' },
        { status: 500 }
      );
    }
    if (existingLegacyAccount) {
      return NextResponse.json({
        success: true,
        virtualAccount: toVirtualAccount(existingLegacyAccount),
        existing: true,
      });
    }
    if (!hasPermission(access, 'orders', 'edit')) {
      return NextResponse.json(
        { code: 'FORBIDDEN', error: 'Forbidden' },
        { status: 403 }
      );
    }
    if (existingVba) {
      const { data: released, error: releaseError } = await supabase.rpc(
        'release_expired_paystack_order_account',
        { p_order_id: orderId }
      );
      if (releaseError) {
        return NextResponse.json(
          {
            code: 'PAYMENT_ACCOUNT_RELEASE_FAILED',
            error: 'Unable to reprovision the automatic confirmation account',
          },
          { status: 500 }
        );
      }
      if (!released) {
        const { data: racedAccount, error: racedAccountError } =
          await loadLatestPaystackOrderAccount(supabase, orderId);

        if (
          !racedAccountError &&
          racedAccount &&
          isActivePaymentAccount(racedAccount)
        ) {
          return NextResponse.json({
            success: true,
            virtualAccount: toVirtualAccount(racedAccount),
            existing: true,
          });
        }

        return NextResponse.json(
          {
            code: 'PAYMENT_ACCOUNT_RELEASE_FAILED',
            error: 'Unable to reprovision the automatic confirmation account',
          },
          { status: 500 }
        );
      }
    }

    const { firstName, lastName } = toCustomerName(order.customer_name);

    let phone = order.customer_phone || '';
    if (!phone) {
      const { data: merchant } = await supabase
        .from('merchants')
        .select('phone')
        .eq('id', merchantId)
        .maybeSingle();
      phone = merchant?.phone || '08000000000';
    }

    const dvaResult = await generatePaymentAccount({
      email: customerEmail,
      firstName,
      lastName,
      phone,
      orderId,
    });
    if (!dvaResult.success) {
      return NextResponse.json(
        { error: `DVA creation failed: ${dvaResult.error}` },
        { status: 502 }
      );
    }
    const reservationResult = await reservePaystackDvaAssignment(supabase, {
      accountName: dvaResult.data.account_name,
      accountNumber: dvaResult.data.account_number,
      bankName: dvaResult.data.bank_name,
      customerEmail,
      orderId,
    });
    if (reservationResult.proofError) {
      return getDvaReservationProofFailureResponse();
    }
    const { data: reservation, error: insertError } = reservationResult;

    const reservationFailure = getDvaReservationFailureResponse(
      reservation,
      insertError
    );
    if (reservationFailure) {
      return reservationFailure;
    }

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const { data: racedAccount, error: racedAccountError } = await supabase
          .from('order_payment_accounts')
          .select(
            'account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at'
          )
          .eq('order_id', orderId)
          .eq('provider', 'paystack')
          .maybeSingle();

        if (!racedAccountError && racedAccount) {
          if (isActivePaymentAccount(racedAccount)) {
            return NextResponse.json({
              success: true,
              virtualAccount: toVirtualAccount(racedAccount),
              existing: true,
            });
          }

          return NextResponse.json(
            {
              code: 'PAYMENT_ACCOUNT_EXPIRED',
              error: 'Automatic confirmation account has expired',
            },
            { status: 410 }
          );
        }
      }

      return NextResponse.json(
        {
          error: 'Failed to save automatic confirmation account',
          code: 'PAYMENT_ACCOUNT_PERSIST_FAILED',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      virtualAccount: {
        account_number: dvaResult.data.account_number,
        bank_name: dvaResult.data.bank_name,
        account_name: dvaResult.data.account_name,
      },
      existing: reservation === 'existing',
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logger.error({ message: 'Generate DVA API error', error: errorMessage });
    return NextResponse.json(
      { error: `DVA creation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
