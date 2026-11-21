const decimalPattern = /^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

/**
 * Round positive naira to safe whole kobo using PostgreSQL numeric half-up
 * semantics. A positive amount below half a kobo rounds to zero. Callers
 * requiring a payable amount must enforce a positive number of kobo.
 */
export function toKobo(
  value: number | string | null | undefined
): number | null {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const [, whole, fraction = '', exponent = '0'] =
    decimalPattern.exec(String(value).trim()) ??
    decimalPattern.exec(String(amount)) ??
    [];
  if (whole === undefined) return null;

  const digits = whole + fraction;
  const significant = digits.replace(/^0+/, '');
  const koboDigits =
    whole.length + Number(exponent) + 2 - (digits.length - significant.length);
  if (koboDigits < 0) return 0;
  if (koboDigits > 16) return null;

  const integer = Number(
    significant.slice(0, koboDigits).padEnd(koboDigits, '0')
  );
  const rounded = integer + (Number(significant[koboDigits]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(rounded) ? rounded : null;
}
