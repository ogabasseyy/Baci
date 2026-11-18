import { normaliseMonnifyWording } from './monnify-text-normalise';

/**
 * Monnify answers that can only come before a vend is attempted: the
 * request's amount check (the production error behind #2612) and Baci's
 * Monnify float being too low to pay for it. Kept deliberately small:
 * "unavailable" answers and FAILED vend statuses can follow a hand-off to
 * the network, and Monnify's "unexpected error" (code 99) says to
 * re-query, so they stay ordinary failures and never reach Kuda.
 */
const MONNIFY_KNOWN_REFUSAL_PATTERN =
  /amount must be greater than zero|insufficient\s+(?:wallet\s+|account\s+)?(?:balance|funds)|(?:wallet\s+|account\s+|available\s+)?(?:balance|funds)\s+(?:is|are)\s+(?:too\s+low|insufficient)/i;

/** Whether a Monnify message is a known refusal that delivered nothing. */
export function isMonnifyKnownVendRefusalText(
  text: string | null | undefined
): boolean {
  // "_" and "-" read as spaces, so INSUFFICIENT_WALLET_BALANCE matches.
  return (
    !!text && MONNIFY_KNOWN_REFUSAL_PATTERN.test(normaliseMonnifyWording(text))
  );
}
