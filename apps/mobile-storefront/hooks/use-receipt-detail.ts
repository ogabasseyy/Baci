import { isManualOrderRecord } from '@baci/shared/receipt';
import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ReceiptDetailSchema } from '@/schemas/receipt';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptDetail } from '@/types/receipt';
import { mapCustomerPaymentAccountRpcRows } from './receipt-payment-account-mappers';
import { isPromotedManualReceipt } from './receipt-promotion-gates';
import { mapCustomerTransactionRpcRows } from './receipt-transaction-mappers';
import { resolveReceiptPaymentAccount } from './resolve-receipt-payment-account';

const log = createLogger('Receipts');

interface ReceiptDetailScope {
  merchantId: string | null;
  userId: string | null;
}

export function resolveReceiptMerchantId(merchantId?: string | null) {
  return merchantId || CONFIG.MERCHANT_ID || null;
}

function getReceiptDetailScope(): ReceiptDetailScope {
  const state = useAuthStore.getState();

  return {
    merchantId: resolveReceiptMerchantId(state.merchantId),
    userId: state.user?.id ?? null,
  };
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
          shipping_status,
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
          invoice_type_code,
          recorded_by_user_id,
          import_job_id,
          external_source,
          order_items (
            id,
            name,
            condition,
            variant_name,
            quantity,
            price,
            image_url,
            assurance_fee,
            line_extension_amount,
            unit_code,
            vat_category_code,
            vat_rate,
            vat_amount,
            item_description,
            sellers_item_id
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

  // Fail-closed dating follows the same promotion gate the preview
  // renders through: a row that previews as an invoice (cancelled,
  // unknown-status, content-invalid) tolerates transaction failures like
  // any unpaid row, while a promoted row fails the whole load rather
  // than render a misdated receipt. The generic paid shortcut applies to
  // non-manual rows only, matching the preview and list classification —
  // a paid-manual row that fails the gate opens as an invoice, so its
  // detail load must tolerate lookup failures too. The status trim is
  // typeof-guarded: the row is unvalidated here, so a numeric marker must
  // fail closed, never throw.
  const manualOrder = isManualOrderRecord({
    recordedByUserId: order.recorded_by_user_id,
    importJobId: order.import_job_id,
    externalSource: order.external_source,
  });
  const isPaidOrder =
    (!manualOrder &&
      typeof order.payment_status === 'string' &&
      order.payment_status.trim().toLowerCase() === 'paid') ||
    (manualOrder &&
      isPromotedManualReceipt({
        recordedByUserId: order.recorded_by_user_id,
        importJobId: order.import_job_id,
        externalSource: order.external_source,
        paymentStatus: order.payment_status,
        shippingStatus: order.shipping_status,
        total: order.total,
        subtotal: order.subtotal,
        shippingFee: order.shipping_fee,
        taxAmount: order.tax_amount,
        discountAmount: order.discount_amount,
        amountPaid: order.amount_paid,
        currency: order.currency,
        items: order.order_items,
      }));
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
    items: (order.order_items ?? []).map((item) =>
      item == null
        ? item
        : {
            ...item,
            product_name: item.name,
            // Rendered description like the emailed PDF input: without
            // this the app link opens a document missing descriptions
            // and SKU labels the attachment shows.
            description: item.item_description || undefined,
          }
    ),
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
