import { joinMonnifyAnswerStrings } from './monnify-answer-strings';

/** Auth wording that names the reason: token, credentials, header, access. */
const SPECIFIC_AUTH_REJECTION =
  /invalid (?:access |bearer )?token|(?:bearer|access) token (?:is )?(?:invalid|missing|required)|missing (?:bearer|access) token|(?:expired|revoked) token|token (?:(?:has|is) )?(?:been )?(?:expired|revoked)|invalid credentials?|authentication (?:failed|failure|required|error)|failed to authenticate|(?:not |un)authenticated|authori[sz]ation (?:header )?(?:is )?(?:missing|required|invalid)|missing authori[sz]ation|(?:unauthori[sz]ed|forbidden)[\s:,-]+(?:request|access|token|credentials?|client|user|api[\s_-]?key)/i;

/** A message that is only "Unauthorized" / "Forbidden" (optional punctuation). */
const BARE_AUTH_MESSAGE =
  /^\s*(?:unauthori[sz]ed|forbidden|access denied)\s*[.!]?\s*$/i;

function stringValues(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (depth > 6 || !value || typeof value !== 'object') {
    return [];
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.flatMap((child) => stringValues(child, depth + 1));
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Whether Monnify's own body (never the status line) reads as an
 * authentication rejection. With `specificOnly`, only wording that names a
 * token, credential or header counts (used for 403s, where a bare "Access
 * denied" may be a post-routing deny). A bare "Unauthorized"/"Forbidden" counts only
 * as the whole message; elsewhere (e.g. a gateway policy note) it needs a
 * token, credential, header, access or client context.
 */
export function readsAsMonnifyAuthRejection(
  body: string,
  { specificOnly = false }: { specificOnly?: boolean } = {}
): boolean {
  if (!body.trim()) {
    return false;
  }
  const parsed = parseJsonOrNull(body);
  const values =
    parsed && typeof parsed === 'object' ? stringValues(parsed) : [body];
  return (
    (!specificOnly && values.some((value) => BARE_AUTH_MESSAGE.test(value))) ||
    SPECIFIC_AUTH_REJECTION.test(
      parsed && typeof parsed === 'object'
        ? joinMonnifyAnswerStrings(parsed)
        : body
    )
  );
}
