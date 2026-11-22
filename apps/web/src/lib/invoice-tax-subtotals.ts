import type { InvoiceLineItem, TaxSubtotal } from '@/lib/invoice-generator';

type TaxSubtotalLineItem = Omit<InvoiceLineItem, 'line_extension_amount'> & {
  line_extension_amount?: number;
};

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function lineTaxableAmount(item: TaxSubtotalLineItem) {
  const lineExtensionAmount = finiteNumber(item.line_extension_amount);
  if (lineExtensionAmount != null) return lineExtensionAmount;

  const quantity = finiteNumber(item.quantity);
  const price = finiteNumber(item.price);

  return quantity != null && price != null ? quantity * price : 0;
}

function exemptionReasonForCategory(vatCategoryCode: string) {
  return vatCategoryCode === 'O' ? 'Outside scope of VAT' : undefined;
}

export function deriveTaxSubtotalsFromInvoiceItems(
  items: TaxSubtotalLineItem[],
  storedRows: TaxSubtotal[] = []
): TaxSubtotal[] {
  const subtotals = new Map<string, TaxSubtotal>();

  for (const item of items) {
    const vatCategoryCode = item.vat_category_code?.trim();
    const vatRate = finiteNumber(item.vat_rate);
    const vatAmount = finiteNumber(item.vat_amount);

    if (!vatCategoryCode || vatRate == null || vatAmount == null) {
      continue;
    }

    const key = `${vatCategoryCode}:${vatRate}`;
    const existing = subtotals.get(key);

    if (existing) {
      existing.taxable_amount += lineTaxableAmount(item);
      existing.tax_amount += vatAmount;
      continue;
    }

    subtotals.set(key, {
      vat_category_code: vatCategoryCode,
      vat_rate: vatRate,
      taxable_amount: lineTaxableAmount(item),
      tax_amount: vatAmount,
      exemption_reason:
        storedRows.find(
          (row) =>
            row.vat_category_code === vatCategoryCode &&
            row.vat_rate === vatRate
        )?.exemption_reason ?? exemptionReasonForCategory(vatCategoryCode),
    });
  }

  return Array.from(subtotals.values());
}
