import { normaliseMonnifyWording } from './monnify-text-normalise';

/**
 * Login/credential wording ("Invalid token", "INVALID_TOKEN", "Unauthorized",
 * "invalid credentials"…). 401/403-style rejections never go to Kuda (owner
 * decision 2026-11-18), on the HTTP and business paths alike and whatever the
 * status code, so any answer carrying this wording stays refund-only.
 */
const AUTH_WORDING =
  /unauthori[sz]ed|unauthenticated|forbidden|access denied|invalid (?:access |bearer )?token|(?:expired|revoked) token|token (?:(?:has|is) )?(?:been )?(?:expired|revoked|invalid|missing)|invalid credentials?|authentication (?:failed|failure|required|error)|failed to authenticate|authori[sz]ation (?:header )?(?:is )?(?:missing|required|invalid)|auth(?:entication)? (?:is )?(?:failed|failure|invalid|error|denied)|not (?:authenticated|authori[sz]ed)|invalid (?:api|secret|client) ?key|(?:api|secret|client) ?key (?:is )?(?:invalid|missing|expired|revoked|required)|invalid (?:client )?(?:id|secret)|credentials? (?:are |is )?(?:invalid|expired|missing|required)|(?:log|sign) ?(?:in|on) (?:has )?(?:failed|failure|denied|required|invalid|error)|failed to (?:log|sign) ?(?:in|on)/i;

/** Whether a Monnify answer carries login/credential wording. */
export function mentionsMonnifyAuthWording(
  text: string | null | undefined
): boolean {
  return !!text && AUTH_WORDING.test(normaliseMonnifyWording(text));
}
