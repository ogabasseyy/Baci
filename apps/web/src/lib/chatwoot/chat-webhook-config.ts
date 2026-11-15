import 'server-only';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Opaque path segment that selects a binding; it is not a credential. */
export const CHAT_WEBHOOK_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SECRET_PATTERN = /^[\x21-\x7e]{24,256}$/;
const MAX_BINDINGS = 256;

/** One store's chat webhook: where it comes from and how it is signed. */
export type ChatWebhookBinding = {
  merchantId: string;
  accountId: number;
  inboxId: number;
  webhookKey: string;
  /** Signing secret shared with the messaging service. Never log it. */
  webhookSecret: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseBindings(raw: string | undefined): ChatWebhookBinding[] | null {
  if (!raw?.trim() || raw.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_BINDINGS) return null;

  const bindings: ChatWebhookBinding[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed) {
    if (!isRecord(candidate)) return null;
    const { merchantId, accountId, inboxId, webhookKey, webhookSecret } =
      candidate;
    if (
      typeof merchantId !== 'string' ||
      !UUID_PATTERN.test(merchantId) ||
      !isPositiveId(accountId) ||
      !isPositiveId(inboxId) ||
      typeof webhookKey !== 'string' ||
      !CHAT_WEBHOOK_KEY_PATTERN.test(webhookKey) ||
      typeof webhookSecret !== 'string' ||
      !SECRET_PATTERN.test(webhookSecret)
    ) {
      return null;
    }
    const normalizedMerchantId = merchantId.toLowerCase();
    // One store per inbox and per endpoint: a shared one would let one
    // store's chat events notify another store.
    const uniques = [
      `merchant:${normalizedMerchantId}`,
      `inbox:${accountId}:${inboxId}`,
      `key:${webhookKey}`,
    ];
    if (uniques.some((unique) => seen.has(unique))) return null;
    for (const unique of uniques) seen.add(unique);
    bindings.push({
      merchantId: normalizedMerchantId,
      accountId,
      inboxId,
      webhookKey,
      webhookSecret,
    });
  }
  return bindings;
}

/**
 * Resolves the endpoint key in the webhook URL to its binding. Returns null
 * when chat notifications are off, misconfigured, or the key is unknown, so
 * the receiver fails closed without revealing which.
 */
export function getChatWebhookBinding(
  webhookKey: string,
  env: NodeJS.ProcessEnv = process.env
): ChatWebhookBinding | null {
  if (env.EKAETTE_CHATWOOT_NOTIFICATIONS_ENABLED !== 'true') return null;
  if (!CHAT_WEBHOOK_KEY_PATTERN.test(webhookKey)) return null;
  const bindings = parseBindings(env.EKAETTE_CHATWOOT_WEBHOOK_BINDINGS);
  if (!bindings) return null;
  return bindings.find((binding) => binding.webhookKey === webhookKey) ?? null;
}
