import { getMoneyCurrencyExponent } from './currency-locales';
import { formatMoney } from './format-money';
import type { FormatMoneyOptions } from './money-formatter';

/** Compact display (e.g. ₦1.2M). Small amounts keep standard notation. */
export function formatMoneyCompact(
  amount: number,
  currencyCode = 'NGN',
  options: FormatMoneyOptions = {}
): string {
  const useCompact = Math.abs(amount) >= 1_000;
  const exponent = getMoneyCurrencyExponent(currencyCode);
  // Apply compact defaults only when the caller supplied neither
  // bound: a lone caller bound must reach getMoneyFormatter's joint
  // min/max resolution alone instead of being paired with a compact
  // default that may contradict it (min 3 vs default max 2).
  const defaults: FormatMoneyOptions = {};
  if (
    options.minimumFractionDigits === undefined &&
    options.maximumFractionDigits === undefined
  ) {
    defaults.minimumFractionDigits = useCompact ? 1 : exponent;
    // Non-compact branch keeps the currency exponent as the maximum so
    // zero-decimal currencies never render fictitious fractions.
    defaults.maximumFractionDigits = useCompact ? 2 : exponent;
  }
  return formatMoney(amount, currencyCode, {
    notation: useCompact ? 'compact' : 'standard',
    compactDisplay: 'short',
    ...defaults,
    ...options,
  });
}
