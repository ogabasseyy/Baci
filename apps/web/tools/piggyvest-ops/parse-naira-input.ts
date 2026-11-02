/**
 * Reads what the approver retyped. Accepts an optional ₦, correctly placed
 * thousands commas and up to two decimals; anything else is refused (null).
 */
export function parseNairaInput(text: string): number | null {
  const match =
    /^₦?((?:[1-9][0-9]{0,2}(?:,[0-9]{3})+)|(?:0|[1-9][0-9]*))(?:\.([0-9]{1,2}))?$/.exec(
      text.trim()
    );
  if (!match) return null;
  const naira = Number(match[1].replaceAll(',', ''));
  const kobo = Number((match[2] ?? '').padEnd(2, '0'));
  const total = naira * 100 + kobo;
  return Number.isSafeInteger(total) ? total : null;
}
