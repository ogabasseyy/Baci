import {
  isManualOrderRecord,
  isNonNegativeMoney,
  isSettledManualBalance,
} from '@baci/shared/receipt';
import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ReceiptDetailSchema } from '@/schemas/receipt';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptDetail } from '@/types/receipt';
import {
  DETAIL_HEADER_MONEY_FIELDS,
  DETAIL_ITEM_MONEY_FIELDS,
  receiptMoneyOverrides,
} from './receipt-detail-money';
import { isReceiptInvoiceTaxValid } from './receipt-invoice-tax-gate';
import { mapCustomerPaymentAccountRpcRows } from './receipt-payment-account-mappers';
import {
  isPromotableManualDocument,
  isPromotedManualReceipt,
} from './receipt-promotion-gates';
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
): Promise<ReceiptDetail | null> {
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
          invoice_note,
          payment_due_date,
          payment_terms,
          buyer_reference,
          firs_irn,
          firs_csid,
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
            line_id,
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

  // Fail-closed dating follows the preview's promotion gate: invoice rows
  // tolerate lookup failures while promoted rows fail the whole load.
  // The paid shortcut is non-manual only; the status trim is
  // typeof-guarded since the row is unvalidated here.
  const manualOrder = isManualOrderRecord({
    recordedByUserId: order.recorded_by_user_id,
    importJobId: order.import_job_id,
    externalSource: order.external_source,
  });
  const paidLabel =
    typeof order.payment_status === 'string' &&
    order.payment_status.trim().toLowerCase() === 'paid';
  const promotionInput = {
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
  };
  const isPaidOrder =
    (!manualOrder && paidLabel) ||
    (manualOrder && isPromotedManualReceipt(promotionInput));
  // A deliverable manual invoice renders its settled payments: without
  // history the preview shows amount_paid with an empty Payment table,
  // while the sender fails the same lookup closed. The aggregate need
  // not reconcile with the ledger, so even zero-progress invoices
  // require history — they still render empty on a successful empty
  // fetch, but a failed fetch fails closed like the list loader.
  // Invalid rows (paid-label-but-unsettled included) stay tolerant:
  // they render as invoices without ever being emailed.
  const settledBalance = isSettledManualBalance({
    total: order.total as number | string | null | undefined,
    amountPaid: order.amount_paid as number | string | null | undefined,
  });
  const requiresPaymentHistory =
    manualOrder &&
    isPromotableManualDocument(promotionInput, true) &&
    !paidLabel &&
    !settledBalance;
  // Deliverable manual invoices gate on the sender-validated tax
  // breakdown before the preview opens; invalid rows stay unexposed.
  if (
    manualOrder &&
    !isPaidOrder &&
    isPromotableManualDocument(promotionInput, true) &&
    !(await isReceiptInvoiceTaxValid(orderId))
  )
    return null;
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
    if (isPaidOrder || requiresPaymentHistory) {
      throw txError;
    }
  }

  const transactions = mapCustomerTransactionRpcRows(transactionRows);

  // Corrupt money must fail the detail closed, never mask to a zero
  // balance: null trips the required-number schema below and the
  // preview releases the spinner through detailFailedClosed.
  const balance =
    isNonNegativeMoney(order.total) && isNonNegativeMoney(order.amount_paid)
      ? Number(order.total) - Number(order.amount_paid)
      : null;
  const detail = {
    ...order,
    // PostgREST numerics arrive as decimal strings (headers, price, item
    // fees alike): coerce before the gate or valid orders fail closed.
    ...receiptMoneyOverrides(order, DETAIL_HEADER_MONEY_FIELDS),
    // The column permits NULL but the renderers read a plain boolean:
    // normalize absent to false so a valid order never fails closed.
    is_credit_order: order.is_credit_order ?? false,
    balance,
    items: (order.order_items ?? []).map((item) => {
      if (item == null) {
        return item;
      }
      return {
        ...item,
        ...receiptMoneyOverrides(item, DETAIL_ITEM_MONEY_FIELDS),
        product_name: item.name,
        // Rendered description like the emailed PDF input: without
        // this the app link opens a document missing descriptions
        // and SKU labels the attachment shows.
        description: item.item_description || undefined,
      };
    }),
    virtual_account: resolveReceiptPaymentAccount(
      virtualAccounts,
      transactions,
      order.payment_status
    ),
    transactions: transactions ?? [],
  };

  const result = ReceiptDetailSchema.safeParse(detail);
  if (!result.success) {
    log.warn('Receipt detail validation failed:', result.error.message);
    return null;
  }

  // The schema gates but does not transform: parsed data would strip the
  // provider/expiry fields the preview and generator read, so the
  // validated object passes through untouched.
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
