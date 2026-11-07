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

function decimalToScaledInteger(value: number | string, scale: number): bigint {
  const match = String(value)
    .trim()
    .match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('Invalid decimal value');

  const [, sign, whole, fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  const digits = BigInt(`${whole}${fraction}` || '0');
  const shift = scale + exponent - fraction.length;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    scaled = (digits + divisor / 2n) / divisor;
  }
  return sign === '-' ? -scaled : scaled;
}

function roundPositiveRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
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
  const lineExtensionCents =
    decimalToScaledInteger(price, 2) * BigInt(quantity);
  const rateHundredths = decimalToScaledInteger(vatRate ?? 7.5, 2);
  const taxCents = roundPositiveRatio(
    lineExtensionCents * rateHundredths,
    10_000n
  );
  return Number(taxCents) / 100;
}
