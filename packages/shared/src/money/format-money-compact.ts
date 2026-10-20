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
  // Apply compact defaults only when the caller supplied neither
  // bound: a lone caller bound must reach getMoneyFormatter's joint
  // min/max resolution alone instead of being paired with a compact
  // default that may contradict it (min 3 vs default max 2). The
  // exponent is derived lazily inside that branch — the only place
  // it is consumed — so compact calls and fully-bounded calls never
  // pay for a discarded Intl derivation.
  const defaults: FormatMoneyOptions = {};
  if (
    options.minimumFractionDigits === undefined &&
    options.maximumFractionDigits === undefined
  ) {
    const exponent = useCompact ? 2 : getMoneyDisplayExponent(currencyCode);
    defaults.minimumFractionDigits = useCompact ? 1 : exponent;
    // Non-compact branch keeps the currency exponent as the maximum so
    // zero-decimal currencies never render fictitious fractions.
    defaults.maximumFractionDigits = exponent;
  }
  return formatMoney(amount, currencyCode, {
    compactDisplay: 'short',
    ...defaults,
    ...options,
    notation: effectiveNotation,
  });
}
