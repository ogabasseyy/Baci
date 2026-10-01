import {
  getPaystackDvaAccountNumberFromTransactions,
  MOBILE_ADMIN_ORDER_ITEMS_COLUMNS,
  type OrderFulfillmentDetails,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import { useQuery } from '@tanstack/react-query';
import { getBranchScopeKey } from '@/lib/branch-scope-query';
import { getEffectiveOrderPaymentSummary } from '@/lib/order-payment-summary';
import { getOrderPaymentTransactionTotals } from '@/lib/order-payment-transaction-totals';
import { ORDER_COLUMNS } from '@/lib/orders';
import { supabase } from '@/lib/supabase';
import { ALL_BRANCH_SCOPE, type BranchScope } from '@/schemas/branch';
import { useBranchScope } from '../useBranchScope';
import { useMerchant } from '../useMerchant';
import { mapOrderItems } from './useOrderDetails-helpers';

function getFirstDisplayNamePart(value: string | null | undefined) {
  return value?.trim().split(/\s+/)[0] || null;
}

export async function fetchOrderById(
  orderId: string,
  merchantId: string,
  scope: BranchScope = ALL_BRANCH_SCOPE
) {
  let orderQuery = supabase
    .from('orders')
    .select(`${ORDER_COLUMNS}, cancelled_at`)
    .eq('id', orderId)
    .eq('merchant_id', merchantId);

  if (scope.type === 'branch') {
    orderQuery = orderQuery.eq('branch_id', scope.branchId);
  }

  const { data: order, error } = await orderQuery.single();

  if (error) {
    throw new Error(error.message);
  }

  const [
    { data: items, error: itemsError },
    { data: transactions, error: transactionsError },
    { data: virtualAccount, error: virtualAccountError },
  ] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        `${MOBILE_ADMIN_ORDER_ITEMS_COLUMNS}, products(name, images, condition, category, category_id, categories(name, slug))`
      )
      .eq('order_id', orderId),
    supabase
      .from('transactions')
      .select('amount, gateway, created_at, metadata, status, transaction_type')
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .eq('transaction_type', 'payment')
      .in('status', ['success', 'completed']),
    supabase
      .from('order_payment_accounts')
      .select(
        'account_number, bank_name, account_name, provider, assignment_customer_email_source, created_at, assigned_at, expires_at'
      )
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
  ]);

  if (itemsError) {
    throw new Error(itemsError.message);
  }

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  if (virtualAccountError) {
    throw new Error(virtualAccountError.message);
  }

  let recordedByName: string | null = null;
  let staffTerminal: {
    account_name: string;
    account_number: string;
    bank_name: string;
  } | null = null;

  if (order.recorded_by_user_id) {
    const { data: staffMember, error: staffMemberError } = await supabase
      .from('staff_members')
      .select('id, name')
      .eq('user_id', order.recorded_by_user_id)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .maybeSingle();

    if (staffMemberError) {
      console.warn(
        'useOrderDetails staff_members lookup error:',
        staffMemberError
      );
    }

    if (staffMember) {
      recordedByName = getFirstDisplayNamePart(staffMember.name);

      const { data: terminal, error: terminalError } = await supabase
        .from('virtual_terminals')
        .select('account_number, account_name, bank')
        .eq('staff_id', staffMember.id)
        .eq('active', true)
        .maybeSingle();

      if (terminalError) {
        console.warn(
          'useOrderDetails virtual_terminals lookup error:',
          terminalError
        );
      }

      if (terminal?.account_number) {
        staffTerminal = {
          account_name: terminal.account_name,
          account_number: terminal.account_number,
          bank_name: terminal.bank,
        };
      }
    } else if (!staffMemberError) {
      const { data: fallbackStaffMember, error: fallbackStaffMemberError } =
        await supabase
          .from('staff_members')
          .select('name')
          .eq('user_id', order.recorded_by_user_id)
          .eq('merchant_id', merchantId)
          .neq('status', 'active')
          .limit(1)
          .maybeSingle();

      if (fallbackStaffMemberError) {
        console.warn(
          'useOrderDetails inactive staff_members lookup error:',
          fallbackStaffMemberError
        );
      }

      recordedByName = getFirstDisplayNamePart(fallbackStaffMember?.name);
    }

    if (!recordedByName) {
      const { data: merchantRecorder, error: merchantRecorderError } =
        await supabase
          .from('merchants')
          .select('business_name, email, user_id')
          .eq('id', merchantId)
          .eq('user_id', order.recorded_by_user_id)
          .maybeSingle();

      if (merchantRecorderError) {
        console.warn(
          'useOrderDetails merchant recorder lookup error:',
          merchantRecorderError
        );
      }

      recordedByName =
        getFirstDisplayNamePart(merchantRecorder?.business_name) ||
        getFirstDisplayNamePart(merchantRecorder?.email?.split('@')[0]);
    }
  }

  const orderTotal = Number(order.total) || 0;
  const { transactionTotal, walletTransactionTotal } =
    getOrderPaymentTransactionTotals(transactions);
  const { amountPaid, balance, paymentStatus } =
    getEffectiveOrderPaymentSummary({
      isCancelled:
        Boolean(order.cancelled_at) || order.shipping_status === 'cancelled',
      orderTotal,
      paymentStatus: order.payment_status,
      storedAmountPaid: Number(order.amount_paid) || 0,
      transactionTotal,
      walletAmountUsed: Number(order.wallet_amount_used) || 0,
      walletTransactionTotal,
    });
  const orderWithMeta = order as {
    fulfillment_details?: OrderFulfillmentDetails | null;
  };

  return {
    ...order,
    amount_paid: amountPaid,
    balance,
    payment_status: paymentStatus,
    fulfillment_details: orderWithMeta.fulfillment_details ?? null,
    items: mapOrderItems(items as Parameters<typeof mapOrderItems>[0]),
    recorded_by_name: recordedByName,
    staff_terminal: staffTerminal,
    virtual_account:
      selectPreferredOrderPaymentAccount(virtualAccount, new Date(), {
        allowExpiredPaystackAccount: paymentStatus === 'paid',
        preferredPaystackAccountNumber:
          paymentStatus === 'paid'
            ? getPaystackDvaAccountNumberFromTransactions(transactions)
            : null,
        allowDeviceClockSkew: true,
      }) || null,
  };
}

export function useOrder(orderId: string) {
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const branchScopeKey = getBranchScopeKey(scope);

  return useQuery({
    enabled: !!orderId && !!merchant?.id,
    queryFn: () => {
      if (!merchant?.id) {
        throw new Error('Merchant ID is required');
      }

      return fetchOrderById(orderId, merchant.id, scope);
    },
    queryKey: ['order', orderId, merchant?.id, branchScopeKey],
    staleTime: 1000 * 60, // 1 minute
  });
}
