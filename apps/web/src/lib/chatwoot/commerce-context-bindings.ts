export const CHATWOOT_BINDING_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHATWOOT_BINDING_WEBSITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type ChatwootTenantBinding = {
  merchantId: string;
  origin: string;
  websiteToken: string;
  inboxId: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict, Edge-safe origin normalizer shared by Chatwoot config and CSP. */
export function normalizeHttpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Parse all merchant bindings with the same duplicate checks as server config. */
export function parseChatwootTenantBindings(
  raw: string | undefined
): ChatwootTenantBinding[] | null {
  if (!raw?.trim() || raw.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > 256) return null;

  const bindings: ChatwootTenantBinding[] = [];
  const seenMerchants = new Set<string>();
  const seenWebsiteTokens = new Set<string>();
  const seenInboxIds = new Set<number>();
  for (const candidate of parsed) {
    if (!isRecord(candidate)) return null;
    const merchantId = candidate.merchantId;
    const origin = normalizeHttpsOrigin(candidate.origin);
    const websiteToken = candidate.websiteToken;
    const inboxId = candidate.inboxId;
    if (
      typeof merchantId !== 'string' ||
      !CHATWOOT_BINDING_UUID_PATTERN.test(merchantId) ||
      !origin ||
      typeof websiteToken !== 'string' ||
      !CHATWOOT_BINDING_WEBSITE_TOKEN_PATTERN.test(websiteToken) ||
      typeof inboxId !== 'number' ||
      !Number.isSafeInteger(inboxId) ||
      inboxId <= 0 ||
      seenMerchants.has(merchantId.toLowerCase()) ||
      seenWebsiteTokens.has(websiteToken) ||
      seenInboxIds.has(inboxId)
    ) {
      return null;
    }
    seenMerchants.add(merchantId.toLowerCase());
    seenWebsiteTokens.add(websiteToken);
    seenInboxIds.add(inboxId);
    bindings.push({
      merchantId: merchantId.toLowerCase(),
      origin,
      websiteToken,
      inboxId,
    });
  }
  return bindings;
}
