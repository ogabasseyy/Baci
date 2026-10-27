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

const UUID_V4_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

/**
 * Accepts exactly the credential form real clients emit: a version-4
 * UUID from crypto.randomUUID(). Anything else (other UUID versions,
 * free-form tokens, whitespace, separators, oversized values) is not
 * a credential and callers must fall back to legacy network identity.
 * Shape alone cannot prove randomness — the server therefore never
 * lets this value be the sole abuse bound (see the network backstop
 * in the web quota identity).
 */
export function isValidCartClientCredential(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}
