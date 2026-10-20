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
  return formatMoney(amount, currencyCode, {
    notation: useCompact ? 'compact' : 'standard',
    compactDisplay: 'short',
    minimumFractionDigits: useCompact ? 1 : exponent,
    maximumFractionDigits: 2,
    ...options,
  });
}
