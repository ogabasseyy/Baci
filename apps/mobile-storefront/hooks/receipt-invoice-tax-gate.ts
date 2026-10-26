import { isNonNegativeMoney } from '@baci/shared/receipt';
import { withSupabaseRetry } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export interface ReceiptInvoiceTaxSubtotal {
  vat_category_code: string | null;
  vat_rate: number | null;
  taxable_amount: number | null;
  tax_amount: number | null;
  exemption_reason: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTaxRow(row: unknown): ReceiptInvoiceTaxSubtotal | null {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    return null;
  }
  const record = row as Record<string, unknown>;
  // Same strictness as the boolean gate: genuine decimal money only —
  // booleans, exponents, and blanks stay invalid, never coerced.
  if (
    ![record.vat_rate, record.taxable_amount, record.tax_amount].every(
      isNonNegativeMoney
    )
  ) {
    return null;
  }
  const vatRate = toFiniteNumber(record.vat_rate);
  const taxable = toFiniteNumber(record.taxable_amount);
  const tax = toFiniteNumber(record.tax_amount);
  if (vatRate == null || taxable == null || tax == null) {
    return null;
  }
  return {
    vat_category_code:
      typeof record.vat_category_code === 'string'
        ? record.vat_category_code
        : null,
    vat_rate: vatRate,
    taxable_amount: taxable,
    tax_amount: tax,
    exemption_reason:
      typeof record.exemption_reason === 'string'
        ? record.exemption_reason
        : null,
  };
}

// Manual invoices render the sender-validated tax breakdown: fetch the
// customer RPC rows and fail closed on invalid subtotals like the
// sender and web archive instead of previewing without them. Fetch
// failures throw (unverifiable); invalid rows return null so the
// detail loader releases the spinner without exposing the preview.
// Valid rows are returned for the preview renderer (VAT Breakdown).
export async function fetchReceiptInvoiceTaxSubtotals(
  orderId: string
): Promise<ReceiptInvoiceTaxSubtotal[] | null> {
  const { data: taxRows, error: taxError } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_customer_order_tax_subtotals', {
        p_order_ids: [orderId],
      }),
    { maxRetries: 2 }
  );
  if (taxError) throw taxError;
  if (!Array.isArray(taxRows)) return null;
  const normalized = taxRows.map(normalizeTaxRow);
  if (normalized.some((row) => row == null)) return null;
  return normalized as ReceiptInvoiceTaxSubtotal[];
}

export async function isReceiptInvoiceTaxValid(
  orderId: string
): Promise<boolean> {
  return (await fetchReceiptInvoiceTaxSubtotals(orderId)) != null;
}
