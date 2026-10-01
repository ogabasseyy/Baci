'use client';

import { AlertCircle, Check, Loader2, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { SocialAdsAccount } from './social-ads-account-parser';
import type { SocialAdsProvider } from './social-ads-reporting-card';

interface SocialAdsAccountDiscoveryPanelProps {
  accounts: SocialAdsAccount[];
  displayName: string;
  error: string | null;
  isChoosing: boolean;
  isDiscoveryError: boolean;
  isLoading: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onRetry: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onSelect: (accountId: string) => void;
  provider: SocialAdsProvider;
  selectedId: string | null;
}

export function SocialAdsAccountDiscoveryPanel({
  accounts,
  displayName,
  error,
  isChoosing,
  isDiscoveryError,
  isLoading,
  isSaving,
  onCancel,
  onRetry,
  onSave,
  onSelect,
  provider,
  selectedId,
}: SocialAdsAccountDiscoveryPanelProps) {
  return (
    <>
      {isChoosing && isLoading && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading {displayName} accounts…
        </div>
      )}

      {isChoosing && !isLoading && accounts.length === 0 && !error && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No accessible {displayName} accounts were found.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isLoading || isSaving}
              onClick={onRetry}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCcw className="size-4" />
              Retry account discovery
            </Button>
            <Button
              disabled={isLoading || isSaving}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isChoosing && !isLoading && !isDiscoveryError && accounts.length > 0 && (
        <div
          aria-label={`${displayName} accounts`}
          className="space-y-2"
          role="radiogroup"
        >
          {accounts.map((account) => (
            <label
              className="flex cursor-pointer items-center justify-between rounded-lg border p-2 text-sm"
              key={account.accountId}
            >
              <span>
                {account.label}
                {(account.currencyCode || account.timezoneName) && (
                  <span className="block text-xs text-muted-foreground">
                    {[account.currencyCode, account.timezoneName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </span>
              <input
                checked={selectedId === account.accountId}
                name={`${provider}-account`}
                onChange={() => onSelect(account.accountId)}
                type="radio"
              />
            </label>
          ))}
          <Button
            disabled={isSaving || !selectedId}
            onClick={onSave}
            size="sm"
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Save account and sync
          </Button>
          <Button
            disabled={isSaving}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          {isChoosing && isDiscoveryError && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isLoading || isSaving}
                onClick={onRetry}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCcw className="size-4" />
                Retry account discovery
              </Button>
              <Button
                disabled={isLoading || isSaving}
                onClick={onCancel}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
