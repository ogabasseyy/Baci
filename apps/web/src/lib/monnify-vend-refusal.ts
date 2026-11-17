/**
 * Monnify answers known to mean the vend was refused before anything was
 * delivered: the amount check (the production error behind #2612), Baci's
 * Monnify float running low, or the product / biller / network being
 * unavailable. This is an allow-list on purpose. Anything else, including
 * Monnify's generic "unexpected error" (code 99, which its docs say to
 * re-query), stays an ordinary failure and is never handed to Kuda.
 */
const MONNIFY_KNOWN_REFUSAL_PATTERN =
  /amount must be greater than zero|insufficient\s+(?:wallet\s+|account\s+)?(?:balance|funds)|(?:product|biller|service|network)\s+(?:is\s+)?(?:currently\s+)?(?:not\s+available|unavailable|inactive|disabled|not\s+active)/i;

/** Whether a Monnify message is a known refusal that delivered nothing. */
export function isMonnifyKnownVendRefusalText(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_KNOWN_REFUSAL_PATTERN.test(text);
}
