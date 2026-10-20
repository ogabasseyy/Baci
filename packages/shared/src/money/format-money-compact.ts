import { getMoneyDisplayExponent } from './currency-locales';
import { formatMoney } from './format-money';
import type { FormatMoneyOptions } from './money-formatter';

/** This helper only ever emits compact or standard notation. */
export interface FormatMoneyCompactOptions
  extends Omit<FormatMoneyOptions, 'notation'> {
  notation?: 'compact' | 'standard';
}

/** Compact display (e.g. ₦1.2M). Small amounts keep standard notation. */
export function formatMoneyCompact(
  amount: number,
  currencyCode = 'NGN',
  rawOptions: FormatMoneyCompactOptions = {}
): string {
  // Strip explicitly-undefined values (common when callers spread
  // optional props) so they cannot overwrite the notation/defaults
  // computed below via the trailing spread.
  const options = Object.fromEntries(
    Object.entries(rawOptions).filter(([, value]) => value !== undefined)
  ) as FormatMoneyCompactOptions;
  // Effective notation: only compact/standard are honored (a rogue
  // scientific/engineering value from a JS caller is ignored), and the
  // fraction-digit defaults derive from the effective notation so the
  // two never desync.
  const effectiveNotation: 'compact' | 'standard' =
    options.notation === 'compact' || options.notation === 'standard'
      ? options.notation
      : Math.abs(amount) >= 1_000
        ? 'compact'
        : 'standard';
  const useCompact = effectiveNotation === 'compact';
  // Fraction defaults by effective notation:
  // - standard: both bounds follow the currency exponent (derived
  //   lazily here, the only branch that consumes it), so zero-decimal
  //   currencies never render fictitious minor units.
  // - compact: fraction digits describe the abbreviated magnitude
  //   (1.5M), not minor units, so defaults are min 1 / max 2 for every
  //   currency; a lone caller bound is paired against those compact
  //   defaults here instead of falling through to the minor-unit
  //   exponent resolution in getMoneyFormatter.
  const defaults: FormatMoneyOptions = {};
  const minOption = options.minimumFractionDigits;
  const maxOption = options.maximumFractionDigits;
  if (useCompact) {
    defaults.minimumFractionDigits =
      minOption ?? (maxOption !== undefined ? Math.min(1, maxOption) : 1);
    defaults.maximumFractionDigits =
      maxOption ?? (minOption !== undefined ? Math.max(2, minOption) : 2);
  } else if (minOption === undefined && maxOption === undefined) {
    const exponent = getMoneyDisplayExponent(currencyCode);
    defaults.minimumFractionDigits = exponent;
    defaults.maximumFractionDigits = exponent;
  }
  return formatMoney(amount, currencyCode, {
    compactDisplay: 'short',
    ...defaults,
    ...options,
    notation: effectiveNotation,
  });
}
