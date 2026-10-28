/**
 * VAT-free assurance premium reconciliation for the shared VAT breakdown.
 * Mirrors apps/web's insurance-assurance-line so every renderer (emailed
 * PDF, mobile preview, shared HTML) totals the premium identically:
 * VAT-registered orders carry the premium in an `O` subtotal, while
 * fully outside-scope orders reconcile `O` up to the tax-exclusive
 * total (BT-109). Idempotent: when the rows already span the target
 * the gap is ~0 and nothing changes, so pre-reconciled inputs pass
 * through untouched and double-counting is impossible.
 */
export const ASSURANCE_TAX_EXEMPTION_REASON =
  'Insurance premium — outside scope of VAT';

export interface AssuranceTaxSubtotalRow {
  vat_category_code?: string | null;
  vat_rate?: number | null;
  taxable_amount?: number | null;
  tax_amount?: number | null;
  exemption_reason?: string | null;
}

/** Sum positive finite assurance fees across order item rows. */
export function sumAssuranceFeeTotals(
  items: ReadonlyArray<{ assurance_fee?: unknown } | null | undefined>
): number {
  const total = items.reduce((sum, item) => {
    const fee = Number(item?.assurance_fee ?? 0);
    return sum + (Number.isFinite(fee) && fee > 0 ? fee : 0);
  }, 0);
  return Number(total.toFixed(2));
}

export function reconcileAssuranceTaxSubtotals(
  taxSubtotals: Array<AssuranceTaxSubtotalRow | null>,
  documentTaxExclusive: number,
  assuranceTotal: number
): void {
  const existingTaxable = taxSubtotals.reduce(
    (sum, subtotal) =>
      sum +
      (typeof subtotal?.taxable_amount === 'number' &&
      Number.isFinite(subtotal.taxable_amount)
        ? subtotal.taxable_amount
        : 0),
    0
  );
  // A positive-rate subtotal means a VAT category is present (shipping /
  // discount live there); otherwise every amount is outside-scope.
  const hasTaxableCategory = taxSubtotals.some(
    (subtotal) =>
      typeof subtotal?.vat_rate === 'number' && subtotal.vat_rate > 0
  );
  // `gap` is already rounded to currency precision, so only a
  // non-positive gap means "nothing to reconcile". A genuine 0.01
  // shortfall must still be folded in (skipping it would leave the
  // document a cent short).
  const gap = hasTaxableCategory
    ? Number(assuranceTotal.toFixed(2))
    : Number((documentTaxExclusive - existingTaxable).toFixed(2));
  if (gap <= 0) return;

  const existing = taxSubtotals.find(
    (subtotal) =>
      subtotal?.vat_category_code === 'O' && (subtotal?.tax_amount ?? 0) === 0
  );
  if (existing) {
    existing.taxable_amount = Number(
      (
        (typeof existing.taxable_amount === 'number' &&
        Number.isFinite(existing.taxable_amount)
          ? existing.taxable_amount
          : 0) + gap
      ).toFixed(2)
    );
    return;
  }

  taxSubtotals.push({
    vat_category_code: 'O',
    vat_rate: 0,
    taxable_amount: gap,
    tax_amount: 0,
    exemption_reason: ASSURANCE_TAX_EXEMPTION_REASON,
  });
}
