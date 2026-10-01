import type { AdsSyncRun } from '@/lib/ads/resolve-sync-run';
import type { GoogleAdsAccount } from './google-ads-account-list';

export async function readGoogleAdsError(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export function parseGoogleAdsSyncRun(payload: unknown): AdsSyncRun | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as { syncRunId?: unknown; syncRunStartedAt?: unknown };
  if (
    typeof value.syncRunId !== 'string' ||
    typeof value.syncRunStartedAt !== 'string'
  ) {
    return null;
  }
  return {
    syncRunId: value.syncRunId,
    syncRunStartedAt: value.syncRunStartedAt,
  };
}

export function parseGoogleAdsAccounts(payload: unknown): GoogleAdsAccount[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const accounts = (payload as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.flatMap((account) => {
    if (typeof account !== 'object' || account === null) return [];
    const value = account as { customerId?: unknown; selected?: unknown };
    return typeof value.customerId === 'string'
      ? [{ customerId: value.customerId, selected: value.selected === true }]
      : [];
  });
}
