'use client';

import { ListRestart, Loader2, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdsSyncRun } from '@/lib/ads/resolve-sync-run';
import {
  type AdsSyncWindow,
  buildAdsSyncWindowChunks,
  buildDefaultAdsSyncWindow,
} from '@/lib/analytics/default-ads-sync-window';
import { fetchWithCsrf } from '@/lib/api-client';
import { SocialAdsAccountDiscoveryPanel } from './social-ads-account-discovery-panel';
import {
  parseSocialAdsAccounts,
  type SocialAdsAccount,
} from './social-ads-account-parser';
import type { SocialAdsProvider } from './social-ads-reporting-card';

interface SocialAdsAccountControlsProps {
  displayName: string;
  merchantId?: string;
  needsAccountSelection: boolean;
  onSynced?: () => void;
  provider: SocialAdsProvider;
  syncWindow?: AdsSyncWindow;
}

type ErrorSource = 'discovery' | 'sync' | 'selection' | null;

const PROVIDER_PATH_SEGMENT: Record<SocialAdsProvider, string> = {
  meta_ads: 'meta',
  snapchat_ads: 'snapchat',
  tiktok_ads: 'tiktok',
};

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function parseSyncRun(payload: unknown): AdsSyncRun | null {
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

export function SocialAdsAccountControls({
  displayName,
  merchantId,
  needsAccountSelection,
  onSynced,
  provider,
  syncWindow,
}: SocialAdsAccountControlsProps) {
  const path = `/api/integrations/ads/${PROVIDER_PATH_SEGMENT[provider]}`;
  const [accounts, setAccounts] = useState<SocialAdsAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isChoosing, setIsChoosing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<ErrorSource>(null);

  const loadAccounts = async () => {
    setIsChoosing(true);
    setIsLoading(true);
    setError(null);
    setErrorSource(null);
    try {
      const response = await fetch(`${path}/accounts`, {
        credentials: 'include',
        headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
      });
      if (!response.ok) {
        throw new Error(
          await responseError(
            response,
            `Unable to load ${displayName} accounts.`
          )
        );
      }
      const payload = (await response.json()) as { accounts?: unknown };
      const nextAccounts = parseSocialAdsAccounts(payload.accounts);
      setAccounts(nextAccounts);
      setSelectedId(
        nextAccounts.find((account) => account.selected)?.accountId ??
          nextAccounts[0]?.accountId ??
          null
      );
    } catch (loadError) {
      setErrorSource('discovery');
      setError(
        loadError instanceof Error
          ? loadError.message
          : `Unable to load ${displayName} accounts.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const sync = async () => {
    const requestedWindow = syncWindow ?? buildDefaultAdsSyncWindow();
    const windows = buildAdsSyncWindowChunks(requestedWindow, provider);
    let syncRun: AdsSyncRun | null = null;
    for (const [index, window] of windows.entries()) {
      const response = await fetchWithCsrf(`${path}/sync`, {
        body: JSON.stringify({
          ...window,
          finalChunk: index === windows.length - 1,
          ...(syncRun ?? {}),
          syncWindowEndDate: requestedWindow.endDate,
          syncWindowStartDate: requestedWindow.startDate,
        }),
        headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, `Unable to sync ${displayName}.`)
        );
      }
      if (index < windows.length - 1) {
        const nextSyncRun = parseSyncRun(await response.json());
        if (!nextSyncRun) {
          throw new Error(
            `${displayName} sync did not return a server-owned run.`
          );
        }
        syncRun = nextSyncRun;
      }
    }
  };

  const syncNow = async () => {
    setIsSaving(true);
    setError(null);
    setErrorSource(null);
    try {
      await sync();
    } catch (syncError) {
      setErrorSource('sync');
      setError(
        syncError instanceof Error
          ? syncError.message
          : `Unable to sync ${displayName}.`
      );
    } finally {
      onSynced?.();
      setIsSaving(false);
    }
  };

  const saveAccount = async () => {
    if (!selectedId) return;
    setIsSaving(true);
    setError(null);
    setErrorSource(null);
    try {
      const response = await fetchWithCsrf(`${path}/accounts`, {
        body: JSON.stringify({ accountId: selectedId }),
        headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
        method: 'PATCH',
      });
      if (!response.ok) {
        throw new Error(
          await responseError(
            response,
            `Unable to select ${displayName} account.`
          )
        );
      }
      try {
        await sync();
      } finally {
        onSynced?.();
      }
      setAccounts((current) =>
        current.map((account) => ({
          ...account,
          selected: account.accountId === selectedId,
        }))
      );
      setIsChoosing(false);
    } catch (saveError) {
      setErrorSource('selection');
      setError(
        saveError instanceof Error
          ? saveError.message
          : `Unable to select ${displayName} account.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  const cancelAccountSelection = () => {
    setAccounts([]);
    setSelectedId(null);
    setIsChoosing(false);
    setError(null);
    setErrorSource(null);
  };

  return (
    <div className="space-y-2">
      {!isChoosing && (
        <div className="flex flex-wrap gap-2">
          {!needsAccountSelection && (
            <Button
              disabled={isSaving}
              onClick={syncNow}
              size="sm"
              type="button"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Sync now
            </Button>
          )}
          <Button
            onClick={loadAccounts}
            size="sm"
            type="button"
            variant="outline"
          >
            <ListRestart className="size-4" />
            {needsAccountSelection ? 'Select account' : 'Change account'}
          </Button>
        </div>
      )}

      <SocialAdsAccountDiscoveryPanel
        accounts={accounts}
        displayName={displayName}
        error={error}
        isChoosing={isChoosing}
        isDiscoveryError={errorSource === 'discovery'}
        isLoading={isLoading}
        isSaving={isSaving}
        onCancel={cancelAccountSelection}
        onRetry={loadAccounts}
        onSave={saveAccount}
        onSelect={setSelectedId}
        provider={provider}
        selectedId={selectedId}
      />
    </div>
  );
}
