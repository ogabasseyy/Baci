import 'server-only';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Any printable, space-free ASCII credential: the provider's token alphabet is
// not part of its contract, so only header-unsafe values are refused.
const API_TOKEN_PATTERN = /^[\x21-\x7e]{16,256}$/;
const MAX_BINDINGS = 256;
// Plain HTTP is allowed only for these exact loopback spellings (a messaging
// service on the same host). Any other loopback form must use HTTPS: the list
// is deliberately not widened to the whole range, so it fails closed.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** One merchant's private link to its Chatwoot account and inbox. */
export type MerchantInboxBinding = {
  merchantId: string;
  accountId: number;
  inboxId: number;
  /** Server-only agent credential. Never return it to a client or log it. */
  apiAccessToken: string;
  /**
   * Optional administrator credential, used only for account reports: the
   * provider lets just administrators read them, and an agent credential is
   * refused. Server-only, like `apiAccessToken`.
   */
  reportsApiAccessToken?: string;
  /**
   * Optional credential of the store's assistant bot. Replies and the
   * hand-over to a person are sent with it, so customers see the assistant
   * (not a staff member). Without it the auto-reply stays off. Server-only.
   */
  botApiAccessToken?: string;
  apiOrigin: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** HTTPS origin, or plain HTTP only for a loopback messaging service. */
export function normalizeMerchantInboxApiOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value.trim());
    const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parseBindings(
  raw: string | undefined,
  apiOrigin: string
): MerchantInboxBinding[] | null {
  if (!raw?.trim() || raw.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_BINDINGS) return null;

  const bindings: MerchantInboxBinding[] = [];
  const seenMerchants = new Set<string>();
  const seenInboxes = new Set<string>();
  for (const candidate of parsed) {
    if (!isRecord(candidate)) return null;
    const { merchantId, accountId, inboxId, apiAccessToken } = candidate;
    const { reportsApiAccessToken, botApiAccessToken } = candidate;
    if (
      typeof merchantId !== 'string' ||
      !UUID_PATTERN.test(merchantId) ||
      !isPositiveId(accountId) ||
      !isPositiveId(inboxId) ||
      typeof apiAccessToken !== 'string' ||
      !API_TOKEN_PATTERN.test(apiAccessToken) ||
      (reportsApiAccessToken !== undefined &&
        (typeof reportsApiAccessToken !== 'string' ||
          !API_TOKEN_PATTERN.test(reportsApiAccessToken))) ||
      (botApiAccessToken !== undefined &&
        (typeof botApiAccessToken !== 'string' ||
          !API_TOKEN_PATTERN.test(botApiAccessToken)))
    ) {
      return null;
    }
    const normalizedMerchantId = merchantId.toLowerCase();
    const inboxKey = `${accountId}:${inboxId}`;
    // One merchant per inbox: a shared inbox would mix two stores' customers.
    if (seenMerchants.has(normalizedMerchantId) || seenInboxes.has(inboxKey)) {
      return null;
    }
    seenMerchants.add(normalizedMerchantId);
    seenInboxes.add(inboxKey);
    bindings.push({
      merchantId: normalizedMerchantId,
      accountId,
      inboxId,
      apiAccessToken,
      ...(typeof reportsApiAccessToken === 'string'
        ? { reportsApiAccessToken }
        : {}),
      ...(typeof botApiAccessToken === 'string' ? { botApiAccessToken } : {}),
      apiOrigin,
    });
  }
  return bindings;
}

/**
 * Resolves the caller's merchant to its inbox binding. Returns null when the
 * inbox is switched off, misconfigured, or this merchant has no binding, so
 * callers fail closed without learning which case applied.
 */
export function getMerchantInboxBinding(
  merchantId: string,
  env: NodeJS.ProcessEnv = process.env
): MerchantInboxBinding | null {
  if (env.EKAETTE_CHATWOOT_INBOX_ENABLED !== 'true') return null;
  const apiOrigin = normalizeMerchantInboxApiOrigin(
    env.EKAETTE_CHATWOOT_INBOX_API_ORIGIN ??
      env.EKAETTE_CHATWOOT_PLATFORM_ORIGIN
  );
  if (!apiOrigin) return null;
  const bindings = parseBindings(
    env.EKAETTE_CHATWOOT_INBOX_BINDINGS,
    apiOrigin
  );
  if (!bindings) return null;
  const normalizedMerchantId = merchantId.toLowerCase();
  return (
    bindings.find((binding) => binding.merchantId === normalizedMerchantId) ??
    null
  );
}
