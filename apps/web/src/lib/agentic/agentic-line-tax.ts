export class TaxComputeError extends Error {
  readonly pgCode: string | undefined;

  constructor(message: string, pgCode?: string | null | undefined) {
    super(message);
    this.name = 'TaxComputeError';
    this.pgCode = typeof pgCode === 'string' ? pgCode : undefined;
  }
}

export function roundAgenticCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Shared VAT category and cent rounding used by checkout quotes and orders. */
export function calculateAgenticLineTax({
  price,
  quantity,
  vatCategoryCode,
  vatRate,
  vatRegistered,
  productId,
}: {
  productId?: string;
  price: number;
  quantity: number;
  vatCategoryCode: string | null | undefined;
  vatRate: number | string | null | undefined;
  vatRegistered: boolean;
}): number {
  if (!vatRegistered || (vatCategoryCode ?? 'S') !== 'S') return 0;
  const rate = Number(vatRate ?? 7.5);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new TaxComputeError(
      `Invalid vat_rate${productId ? ` on product ${productId}` : ''}: got ${String(vatRate)}`
    );
  }
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return roundAgenticCents((roundAgenticCents(quantity * price) * rate) / 100);
}
