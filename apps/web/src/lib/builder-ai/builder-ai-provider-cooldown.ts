const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_TRACKED_PROVIDERS = 3;

const cooldownUntilByProvider = new Map<string, number>();

function hasRateLimitStatus(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return candidate.status === 429 || candidate.statusCode === 429;
}

function isRateLimitError(error: unknown): boolean {
  if (hasRateLimitStatus(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:quota|rate[ _-]?limit|too many requests)/i.test(message);
}

function ensureBounded(providerName: string): void {
  if (cooldownUntilByProvider.has(providerName)) return;
  if (cooldownUntilByProvider.size < MAX_TRACKED_PROVIDERS) return;
  const oldest = cooldownUntilByProvider.keys().next().value;
  if (oldest) cooldownUntilByProvider.delete(oldest);
}

export const builderAiProviderCooldown = {
  isCoolingDown(providerName: string, now: number = Date.now()): boolean {
    const until = cooldownUntilByProvider.get(providerName);
    if (!until) return false;
    if (until <= now) {
      cooldownUntilByProvider.delete(providerName);
      return false;
    }
    return true;
  },
  isRateLimitError,
  recordFailure(providerName: string, error: unknown): void {
    if (!isRateLimitError(error)) return;
    ensureBounded(providerName);
    cooldownUntilByProvider.set(providerName, Date.now() + DEFAULT_COOLDOWN_MS);
  },
  resetForTests(): void {
    cooldownUntilByProvider.clear();
  },
};
