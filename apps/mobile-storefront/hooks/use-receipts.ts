import { compareReceiptListDesc } from '@baci/shared';
import { isManualOrderRecord } from '@baci/shared/receipt';
import { useQuery } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ReceiptListItemSchema } from '@/schemas/receipt';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptListItem } from '@/types/receipt';
import { selectReceiptCompletionDate } from './receipt-completion-date';
import { isPromotedManualReceipt } from './receipt-promotion-gates';
import { mapCustomerTransactionRpcRows } from './receipt-transaction-mappers';
import { resolveReceiptMerchantId } from './use-receipt-detail';

const log = createLogger('Receipts');

// Ownership-checked transaction RPC caps each call at 100 order ids.
const TRANSACTION_RPC_BATCH_SIZE = 100;

// PostgREST numeric columns arrive as decimal strings while the card
// formats numbers: normalize once here so the card never formats raw
// unvalidated values. Unparseable totals degrade to 0 instead of NaN.
function toDisplayMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

async function loadReceiptCompletionDates(
  orderIds: string[]
): Promise<Map<string, string>> {
  const completionByOrderId = new Map<string, string>();
  for (
    let offset = 0;
    offset < orderIds.length;
    offset += TRANSACTION_RPC_BATCH_SIZE
  ) {
    const { data, error: txError } = await withSupabaseRetry(
      async () =>
        await supabase.rpc('get_customer_order_transactions', {
          p_order_ids: orderIds.slice(
            offset,
            offset + TRANSACTION_RPC_BATCH_SIZE
          ),
        }),
      { maxRetries: 2 }
    );
    // Fail closed like the web orders route (which 500s when its
    // transaction fetch fails): a receipt must never file under a
    // stale invoice date.
    if (txError) {
      log.warn('Failed to fetch receipt transactions:', txError.message);
      throw txError;
    }
    const byOrderId = new Map<string, unknown[]>();
    for (const txn of mapCustomerTransactionRpcRows(data) ?? []) {
      const rows = byOrderId.get(txn.order_id) ?? [];
      rows.push(txn);
      byOrderId.set(txn.order_id, rows);
    }
    for (const [orderId, txns] of byOrderId) {
      const completion = selectReceiptCompletionDate(txns);
      if (completion) completionByOrderId.set(orderId, completion);
    }
  }
  return completionByOrderId;
}

export { useMerchantReceiptInfo } from './use-merchant-receipt-info';
export {
  receiptDetailQueryOptions,
  useReceiptDetail,
} from './use-receipt-detail';

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
              shipping_status,
              recorded_by_user_id,
              import_job_id,
              external_source,
              total,
              subtotal,
              shipping_fee,
              tax_amount,
              discount_amount,
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
                image_url,
                assurance_fee,
                line_extension_amount,
                line_id,
                vat_rate,
                vat_amount
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

      const mapped = (data || []).map((order) => {
        const items = (order.order_items ?? []).map((item) =>
          item == null ? item : { ...item, product_name: item.name }
        );
        // Badge/action kind through the same promotion gate the preview
        // renders through — and with the same manual routing: the generic
        // paid shortcut applies to non-manual rows only, so a cancelled or
        // underfunded paid-manual row says invoice here and opens an
        // invoice there instead of "View Receipt" into an invoice.
        const manualOrder = isManualOrderRecord({
          recordedByUserId: order.recorded_by_user_id,
          importJobId: order.import_job_id,
          externalSource: order.external_source,
        });
        const paidShortcut =
          !manualOrder &&
          typeof order.payment_status === 'string' &&
          order.payment_status.trim().toLowerCase() === 'paid';
        const document_kind =
          paidShortcut ||
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
            }))
            ? 'receipt'
            : 'invoice';
        return {
          ...order,
          items,
          document_kind,
          total: toDisplayMoney(order.total),
          amount_paid: toDisplayMoney(order.amount_paid),
        };
      });

      // Receipts are dated by their completing payment like the web
      // transform and the preview: without this the card and the sort
      // file an October receipt under its January invoice date.
      const receiptIds = mapped
        .filter((row) => row.document_kind === 'receipt')
        .map((row) => row.id);
      const completionByOrderId = await loadReceiptCompletionDates(receiptIds);
      const dated = mapped.map((row) => {
        // Same normalization the preview applies: a receipt is dated by
        // its completing payment, else the sale date — never by the stale
        // invoice issue date, which the card would otherwise prefer.
        if (row.document_kind !== 'receipt') return row;
        return {
          ...row,
          transaction_date:
            completionByOrderId.get(row.id) ?? row.transaction_date,
          invoice_issue_date: null,
        };
      });

      const result = ReceiptListItemSchema.array().safeParse(dated);
      if (!result.success) {
        log.warn('Receipt list validation warning:', result.error.message);
      }

      // File backdated invoices by the same issue → transaction → creation
      // date the receipt card renders; the database pre-sort above cannot
      // express that fallback.
      const receipts = dated as ReceiptListItem[];
      receipts.sort(compareReceiptListDesc);
      return receipts;
    },
    staleTime: 1000 * 60 * 2,
    enabled: !!userId && !!activeMerchantId,
    networkMode: 'always',
    retry: false,
  });
}
