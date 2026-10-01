'use client';

import { AlertCircle, CheckCircle2, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { AdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import { cn } from '@/lib/utils';
import { AdsDisconnectButton } from './ads-disconnect-button';
import { SocialAdsAccountControls } from './social-ads-account-controls';
import { SocialAdsConnectAction } from './social-ads-connect-action';
import type {
  SocialAdsProvider,
  SocialAdsProviderReporting,
} from './social-ads-reporting-card';

interface SpendByCurrency {
  currencyCode: string;
  spendAmountDecimal: string;
}

const PATH_SEGMENT = {
  meta_ads: 'meta',
  snapchat_ads: 'snapchat',
  tiktok_ads: 'tiktok',
} as const satisfies Record<SocialAdsProvider, 'meta' | 'snapchat' | 'tiktok'>;

export function formatSocialAdsCount(value: string): string {
  const number = Number(value);
  return Number.isSafeInteger(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
        number
      )
    : value;
}

export function formatSocialAdsSpend({
  currencyCode,
  spendAmountDecimal,
}: SpendByCurrency): string {
  const value = Number(spendAmountDecimal);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    return `${currencyCode} ${spendAmountDecimal}`;
  }
  try {
    return new Intl.NumberFormat('en-US', {
      currency: currencyCode,
      style: 'currency',
    }).format(value);
  } catch {
    return `${currencyCode} ${spendAmountDecimal}`;
  }
}

function formatSyncTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function ReportingReadFailure({
  displayName,
  error,
  onRetry,
}: {
  displayName: string;
  error: string | null;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertDescription>
        <p>{error ?? 'Reporting data is temporarily unavailable.'}</p>
        {onRetry && (
          <Button
            className="mt-2"
            onClick={onRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw className="size-4" />
            Retry {displayName} reporting
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function SocialAdsProviderPanel({
  canManageIntegrations,
  merchantId,
  onSynced,
  provider,
  syncWindow,
}: {
  canManageIntegrations: boolean;
  merchantId?: string;
  onSynced?: () => void;
  provider: SocialAdsProviderReporting;
  syncWindow?: AdsSyncWindow;
}) {
  const connectPath = new URL(
    `/api/integrations/ads/${PATH_SEGMENT[provider.provider]}/connect`,
    'https://usebaci.com'
  );
  if (merchantId) connectPath.searchParams.set('merchantId', merchantId);
  const connectHref = `${connectPath.pathname}${connectPath.search}`;
  const syncedAt = formatSyncTime(provider.lastSyncedAt);
  const hasReportingReadFailure = provider.dataStatus !== 'ready';
  const hasConfirmedConnectionError =
    provider.dataStatus === 'ready' && provider.connectionStatus === 'error';
  const canManageCredential =
    canManageIntegrations && provider.dataStatus === 'ready';

  return (
    <section
      className="space-y-3 rounded-xl border p-3"
      aria-label={`${provider.displayName} reporting`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{provider.displayName}</h3>
          <p className="text-xs text-muted-foreground">
            {[provider.accountName, provider.accountTimezone]
              .filter(Boolean)
              .join(' · ') || 'No reporting account selected'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-xs',
            hasReportingReadFailure
              ? 'bg-destructive/10 text-destructive'
              : provider.connectionStatus === 'connected'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : provider.connectionStatus === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground'
          )}
        >
          {hasReportingReadFailure
            ? 'Reporting unavailable'
            : provider.connectionStatus === 'connected'
              ? 'Connected'
              : provider.connectionStatus === 'error'
                ? 'Needs attention'
                : 'Not connected'}
        </span>
      </div>

      {provider.connectionStatus !== 'connected' ? (
        <div className="space-y-2">
          {hasReportingReadFailure ? (
            <ReportingReadFailure
              displayName={provider.displayName}
              error={provider.error}
              onRetry={onSynced}
            />
          ) : provider.error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{provider.error}</AlertDescription>
            </Alert>
          ) : null}
          {canManageCredential && (
            <SocialAdsConnectAction
              displayName={provider.displayName}
              href={connectHref}
              reconnect={hasConfirmedConnectionError}
            />
          )}
        </div>
      ) : (
        <>
          {hasReportingReadFailure && (
            <ReportingReadFailure
              displayName={provider.displayName}
              error={provider.error}
              onRetry={onSynced}
            />
          )}
          {provider.isStale && (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>
                Reporting is stale. Sync this account to refresh its metrics.
              </AlertDescription>
            </Alert>
          )}
          {provider.metrics ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {provider.metrics.spendByCurrency.map((spend) => (
                <Metric
                  key={spend.currencyCode}
                  label={`Spend (${spend.currencyCode})`}
                  value={formatSocialAdsSpend(spend)}
                />
              ))}
              <Metric
                label="Impressions"
                value={formatSocialAdsCount(provider.metrics.impressions)}
              />
              <Metric
                label={provider.clicksLabel}
                value={formatSocialAdsCount(provider.metrics.clicks)}
              />
              {provider.metrics.reach !== null && (
                <Metric
                  label="Reach"
                  value={formatSocialAdsCount(provider.metrics.reach)}
                />
              )}
              <Metric
                label={provider.conversionsLabel}
                value={formatSocialAdsCount(provider.metrics.conversions)}
              />
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>
                {provider.needsAccountSelection
                  ? 'Choose a reporting account to import daily metrics.'
                  : 'This account is connected. Metrics appear after the first sync.'}
              </p>
            </div>
          )}
          {canManageIntegrations && (
            <SocialAdsAccountControls
              displayName={provider.displayName}
              merchantId={merchantId}
              needsAccountSelection={provider.needsAccountSelection}
              onSynced={onSynced}
              provider={provider.provider}
              syncWindow={syncWindow}
            />
          )}
        </>
      )}

      {canManageCredential &&
        (provider.connectionStatus === 'connected' ||
          hasConfirmedConnectionError) && (
          <AdsDisconnectButton
            displayName={provider.displayName}
            merchantId={merchantId}
            onDisconnected={onSynced}
            provider={PATH_SEGMENT[provider.provider]}
          />
        )}

      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>Source: {provider.displayName} reporting</span>
        {syncedAt && <span>Last synced {syncedAt}</span>}
      </div>
    </section>
  );
}
