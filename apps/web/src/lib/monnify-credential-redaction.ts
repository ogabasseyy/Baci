/** "Bearer|Basic|Digest <value>" in a message or echoed header. */
const AUTH_SCHEME_VALUE = /\b(bearer|basic|digest)\s+[^\s"',;&]+/gi;
/** A JWT (three base64url parts, header starting "eyJ"). */
const JWT = /\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g;
/** A credential-named field followed by its value: "access token: abc…". */
const CREDENTIAL_FIELD_VALUE =
  /\b((?:access[\s_-]*|bearer[\s_-]*|refresh[\s_-]*)?token|api[\s_-]*key|secret|password|authori[sz]ation|credentials?)(["']?\s*[:=]\s*["']?)(?!(?:bearer|basic|digest)\b|\[redacted\])[^\s"',;&]+/gi;
/**
 * A credential label followed by its value with only whitespace between
 * ("API key sk_abc…", "Invalid token abc123"): any value with a digit, or
 * 12+ token characters, that is not a status word.
 */
const CREDENTIAL_LABEL_VALUE =
  /\b(api[\s_-]*key|(?:(?:access|bearer|refresh)[\s_-]*)?token|secret|password)(\s+)(?!(?:is|has|was|expired|revoked|invalid|missing|required)\b|\[redacted\])(?:(?=[\w.+/=-]*\d)[\w.+/=-]{3,}|[\w.+/=-]{12,})/gi;
/**
 * Any long opaque value (24+ token characters with a digit): keys, hashes.
 * Baci's own 24-hex request references are kept readable for reconciliation.
 */
const LONG_OPAQUE_VALUE =
  /(?<![\w.+/=-])(?![0-9a-f]{24}(?![\w.+/=-]))(?=[\w.+/=-]*\d)(?=[\w.+/=-]*[A-Za-z])[\w.+/=-]{24,}(?![\w.+/=-])/g;

/**
 * Hides credentials Monnify may echo back (bearer tokens, JWTs, API keys,
 * secrets, long opaque values) before any text is stored or logged.
 */
export function redactMonnifyCredentials(text: string): string {
  return text
    .replace(AUTH_SCHEME_VALUE, '$1 [redacted]')
    .replace(JWT, '[redacted]')
    .replace(CREDENTIAL_FIELD_VALUE, '$1$2[redacted]')
    .replace(CREDENTIAL_LABEL_VALUE, '$1$2[redacted]')
    .replace(LONG_OPAQUE_VALUE, '[redacted]');
}
