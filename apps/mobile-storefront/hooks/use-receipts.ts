import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ReceiptDetailSchema, ReceiptListItemSchema } from '@/schemas/receipt';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptDetail, ReceiptListItem } from '@/types/receipt';
import { mapCustomerPaymentAccountRpcRows } from './receipt-payment-account-mappers';
import { mapCustomerTransactionRpcRows } from './receipt-transaction-mappers';
import { resolveReceiptPaymentAccount } from './resolve-receipt-payment-account';

const log = createLogger('Receipts');

export { useMerchantReceiptInfo } from './use-merchant-receipt-info';

interface ReceiptDetailScope {
  merchantId: string | null;
  userId: string | null;
}

function resolveReceiptMerchantId(merchantId?: string | null) {
  return merchantId || CONFIG.MERCHANT_ID || null;
}

function getReceiptDetailScope(): ReceiptDetailScope {
  const state = useAuthStore.getState();

  return {
    merchantId: resolveReceiptMerchantId(state.merchantId),
    userId: state.user?.id ?? null,
  };
}

export function useReceipts(userId: string | undefined) {
  const activeMerchantId = useAuthStore((state) =>
    resolveReceiptMerchantId(state.merchantId)
  );

  return useQuery<ReceiptListItem[]>({
    queryKey: ['receipts', userId, activeMerchantId],
    queryFn: async () => {
      if (!userId || !activeMerchantId) return [];

      const { data, error } = await withSupabaseRetry(
        async () =>
          await supabase
            .from('orders')
            .select(
              `
              id,
              order_number,
              payment_status,
              total,
              amount_paid,
              currency,
              created_at,
              transaction_date,
              invoice_issue_date,
              order_items (
                id,
                name,
                condition,
                variant_name,
                quantity,
                price,
                image_url
              ),
              customers!inner (
                user_id
              )
            `
            )
            .eq('customers.user_id', userId)
            .eq('merchant_id', activeMerchantId)
            .order('transaction_date', {
              ascending: false,
              nullsFirst: false,
            })
            .order('created_at', { ascending: false }),
        { maxRetries: 3 }
      );

      if (error) throw error;

      const mapped = (data || []).map((order) => ({
        ...order,
        items: (order.order_items ?? []).map((item) => ({
          ...item,
          product_name: item.name,
        })),
      }));

      const result = ReceiptListItemSchema.array().safeParse(mapped);
      if (!result.success) {
        log.warn('Receipt list validation warning:', result.error.message);
      }

      return mapped as ReceiptListItem[];
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!userId && !!activeMerchantId,
    networkMode: 'always',
    retry: false,
  });
}

async function fetchReceiptDetail(
  orderId: string,
  scope: ReceiptDetailScope
): Promise<ReceiptDetail> {
  if (!scope.userId || !scope.merchantId) {
    throw new Error('Authentication required to load receipt');
  }

  const { data: order, error: orderError } = await withSupabaseRetry(
    async () =>
      await supabase
        .from('orders')
        .select(
          `
          id,
          order_number,
          payment_status,
          payment_method,
          total,
          subtotal,
          shipping_fee,
          discount_amount,
          tax_amount,
          amount_paid,
          currency,
          is_credit_order,
          created_at,
          transaction_date,
          invoice_issue_date,
          notes,
          customer_name,
          customer_email,
          customer_phone,
          shipping_address,
          order_items (
            id,
            name,
            condition,
            variant_name,
            quantity,
            price,
            image_url
          ),
          customers!inner (
            user_id
          )
        `
        )
        .eq('id', orderId)
        .eq('merchant_id', scope.merchantId)
        .eq('customers.user_id', scope.userId)
        .single(),
    { maxRetries: 3 }
  );

  if (orderError) throw orderError;
  if (!order) throw new Error('Order not found');

  const isPaidOrder = order.payment_status?.trim().toLowerCase() === 'paid';
  const { data: virtualAccountRows, error: vaError } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_customer_order_payment_accounts', {
        p_order_ids: [orderId],
      }),
    { maxRetries: 2 }
  );
  if (vaError) {
    log.warn('Failed to fetch virtual account:', vaError.message);
    throw vaError;
  }
  const virtualAccounts = mapCustomerPaymentAccountRpcRows(virtualAccountRows);

  const { data: transactionRows, error: txError } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_customer_order_transactions', {
        p_order_ids: [orderId],
      }),
    { maxRetries: 2 }
  );
  if (txError) {
    log.warn('Failed to fetch transactions:', txError.message);
    if (isPaidOrder) {
      throw txError;
    }
  }

  const transactions = mapCustomerTransactionRpcRows(transactionRows);

  const detail = {
    ...order,
    balance: (order.total ?? 0) - (order.amount_paid ?? 0),
    items: (order.order_items ?? []).map((item) => ({
      ...item,
      product_name: item.name,
    })),
    virtual_account: resolveReceiptPaymentAccount(
      virtualAccounts,
      transactions,
      order.payment_status
    ),
    transactions: transactions ?? [],
  };

  const result = ReceiptDetailSchema.safeParse(detail);
  if (!result.success) {
    log.warn('Receipt detail validation warning:', result.error.message);
  }

  return detail as ReceiptDetail;
}

export function receiptDetailQueryOptions(
  orderId: string,
  scope: ReceiptDetailScope = getReceiptDetailScope()
) {
  return {
    queryKey: [
      'receipt-detail',
      orderId,
      scope.userId,
      scope.merchantId,
    ] as const,
    queryFn: () => fetchReceiptDetail(orderId, scope),
    staleTime: 1000 * 60 * 5,
    networkMode: 'always' as const,
    retry: false,
  };
}

export function useReceiptDetail(orderId: string | null) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const activeMerchantId = useAuthStore((state) =>
    resolveReceiptMerchantId(state.merchantId)
  );

  return useQuery<ReceiptDetail | null>({
    queryKey: ['receipt-detail', orderId, userId, activeMerchantId],
    queryFn: () => {
      if (!orderId || !userId || !activeMerchantId) return null;
      return fetchReceiptDetail(orderId, {
        merchantId: activeMerchantId,
        userId,
      });
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!orderId && !!userId && !!activeMerchantId,
    networkMode: 'always',
    retry: false,
  });
}
