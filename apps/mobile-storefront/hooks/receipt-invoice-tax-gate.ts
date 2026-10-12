import { isNonNegativeMoney } from '@baci/shared/receipt';
import { withSupabaseRetry } from '@/lib/api';
import { supabase } from '@/lib/supabase';

// Manual invoices render the sender-validated tax breakdown: fetch the
// customer RPC rows and fail closed on invalid subtotals like the
// sender and web archive instead of previewing without them. Fetch
// failures throw (unverifiable); invalid rows return false so the
// detail loader releases the spinner without exposing the preview.
export async function isReceiptInvoiceTaxValid(
  orderId: string
): Promise<boolean> {
  const { data: taxRows, error: taxError } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_customer_order_tax_subtotals', {
        p_order_ids: [orderId],
      }),
    { maxRetries: 2 }
  );
  if (taxError) throw taxError;
  if (!Array.isArray(taxRows)) return false;
  return taxRows.every(
    (row) =>
      row != null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      [row.vat_rate, row.taxable_amount, row.tax_amount].every(
        isNonNegativeMoney
      )
  );
}
