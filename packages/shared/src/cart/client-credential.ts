/**
 * Anonymous client credential for cart quota identity.
 *
 * Each client (browser profile, app install) generates one random
 * credential, persists it, and sends it on cart calls. The server keys
 * anonymous cart budgets on a hash of this credential instead of the
 * network address, so shoppers behind shared egress (carrier NAT,
 * corporate proxies, Cloudflare) never consume each other's budgets.
 *
 * This is a quota identity, NEVER an authentication credential: it
 * grants no access to any cart. Cart authorization stays on the
 * session proofs and grants issued by the server. Treat the header
 * like a session identifier for logging purposes: never log it raw.
 */
export const CART_CLIENT_CREDENTIAL_HEADER = 'x-baci-client-credential';

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * Strict shape check with an entropy floor: a canonical UUID, or a
 * 32–64 character base64url token. Anything else (short strings,
 * whitespace, separators, oversized values) is not a credential and
 * callers must fall back to legacy network identity.
 */
export function isValidCartClientCredential(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (UUID_PATTERN.test(value) || TOKEN_PATTERN.test(value))
  );
}
