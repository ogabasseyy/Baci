'use client';

import { AlertCircle, ListRestart, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { AdsSyncRun } from '@/lib/ads/resolve-sync-run';
import {
  type AdsSyncWindow,
  buildAdsSyncWindowChunks,
  buildDefaultAdsSyncWindow,
} from '@/lib/analytics/default-ads-sync-window';
import { fetchWithCsrf } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  type GoogleAdsAccount,
  GoogleAdsAccountList,
} from './google-ads-account-list';
import {
  parseGoogleAdsAccounts,
  parseGoogleAdsSyncRun,
  readGoogleAdsError,
} from './google-ads-account-picker-helpers';

const ACCOUNTS_PATH = '/api/integrations/ads/google/accounts' as const;
const SYNC_PATH = '/api/integrations/ads/google/sync' as const;

interface GoogleAdsAccountPickerProps {
  className?: string;
  merchantId?: string;
  onSynced?: () => void;
  syncWindow?: AdsSyncWindow;
}

export function GoogleAdsAccountPicker({
  className,
  merchantId,
  onSynced,
  syncWindow,
}: GoogleAdsAccountPickerProps) {
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncComplete, setSyncComplete] = useState(false);

  const loadAccounts = async () => {
    setIsOpen(true);
    setIsLoadingAccounts(true);
    setError(null);
    setSyncComplete(false);

    try {
      const response = await fetch(ACCOUNTS_PATH, {
        credentials: 'include',
        headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
      });
      if (!response.ok) {
        throw new Error(
          await readGoogleAdsError(
            response,
            'Unable to discover Google Ads accounts.'
          )
        );
      }

      const payload = (await response.json()) as {
        accounts?: unknown;
      };
      const nextAccounts = parseGoogleAdsAccounts(payload);
      setAccounts(nextAccounts);
      setSelectedCustomerId(
        nextAccounts.find((account) => account.selected)?.customerId ??
          nextAccounts[0]?.customerId ??
          null
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to discover Google Ads accounts.'
      );
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const selectAccount = async () => {
    if (!selectedCustomerId) return;

    setIsSaving(true);
    setError(null);
    try {
      const selectionResponse = await fetchWithCsrf(ACCOUNTS_PATH, {
        body: JSON.stringify({ customerId: selectedCustomerId }),
        headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
        method: 'PATCH',
      });
      if (!selectionResponse.ok) {
        throw new Error(
          await readGoogleAdsError(
            selectionResponse,
            'Unable to select the Google Ads account.'
          )
        );
      }

      try {
        const requestedWindow = syncWindow ?? buildDefaultAdsSyncWindow();
        const windows = buildAdsSyncWindowChunks(requestedWindow, 'google_ads');
        let syncRun: AdsSyncRun | null = null;
        for (const [index, window] of windows.entries()) {
          const response = await fetchWithCsrf(SYNC_PATH, {
            body: JSON.stringify({
              ...window,
              finalChunk: index === windows.length - 1,
              ...(syncRun ?? {}),
              syncWindowEndDate: requestedWindow.endDate,
              syncWindowStartDate: requestedWindow.startDate,
            }),
            headers: merchantId
              ? { 'x-baci-merchant-id': merchantId }
              : undefined,
            method: 'POST',
          });
          if (!response.ok) {
            throw new Error(
              await readGoogleAdsError(
                response,
                'Google Ads account selected, but sync failed.'
              )
            );
          }
          if (index < windows.length - 1) {
            const nextSyncRun = parseGoogleAdsSyncRun(await response.json());
            if (!nextSyncRun) {
              throw new Error(
                'Google Ads sync did not return a server-owned run.'
              );
            }
            syncRun = nextSyncRun;
          }
        }
      } finally {
        onSynced?.();
      }

      setSyncComplete(true);
      setAccounts((currentAccounts) =>
        currentAccounts.map((account) => ({
          ...account,
          selected: account.customerId === selectedCustomerId,
        }))
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to select the Google Ads account.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const closePicker = () => {
    setIsOpen(false);
    setAccounts([]);
    setSelectedCustomerId(null);
    setError(null);
    setSyncComplete(false);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {!isOpen && (
        <Button
          className="gap-2"
          onClick={loadAccounts}
          size="sm"
          type="button"
        >
          <ListRestart className="size-4" />
          Select Google Ads account
        </Button>
      )}

      {isOpen && isLoadingAccounts && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Discovering Google Ads accounts…
        </div>
      )}

      {isOpen && !isLoadingAccounts && accounts.length === 0 && !error && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No accessible Google Ads accounts were found for this login.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={loadAccounts}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry account discovery
            </Button>
            <Button onClick={closePicker} size="sm" type="button">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isOpen && !isLoadingAccounts && accounts.length > 0 && (
        <GoogleAdsAccountList
          accounts={accounts}
          isSaving={isSaving}
          onCancel={closePicker}
          onSave={selectAccount}
          onSelect={setSelectedCustomerId}
          selectedCustomerId={selectedCustomerId}
        />
      )}

      {error && (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={loadAccounts}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry account discovery
            </Button>
            {accounts.length === 0 && (
              <Button onClick={closePicker} size="sm" type="button">
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {syncComplete && !error && (
        <p
          className="text-sm text-emerald-600 dark:text-emerald-400"
          role="status"
        >
          Google Ads account selected. Spend sync started.
        </p>
      )}
    </div>
  );
}
