import { getMoneyCurrencyExponent } from '@baci/shared/money';

/** Whether a major-unit amount is an exact amount of this currency's minor unit. */
export function isMajorAmountRepresentable(
  amount: number,
  currency: string
): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  let scale: number;
  try {
    scale = 10 ** getMoneyCurrencyExponent(currency);
  } catch {
    return false;
  }
  const scaled = amount * scale;
  const minor = Math.round(scaled);
  const tolerance = Math.min(
    1e-10 + Number.EPSILON * Math.abs(scaled) * 4,
    0.01
  );
  return Number.isSafeInteger(minor) && Math.abs(scaled - minor) <= tolerance;
}
