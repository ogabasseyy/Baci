'use client';

import { AlertCircle, BarChart3, CheckCircle2, Loader2 } from 'lucide-react';
import { GoogleAdsAccountPicker } from '@/components/analytics/google-ads-account-picker';
import { GoogleAdsConnectButton } from '@/components/analytics/google-ads-connect-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BentoCard } from '@/components/ui/bento-card';
import type { AdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import { cn } from '@/lib/utils';
import { AdsDisconnectButton } from './ads-disconnect-button';
import { formatGoogleAdsReportingWindow } from './google-ads-reporting-format';
import { GoogleAdsReportingMetricsGrid } from './google-ads-reporting-metrics-grid';
import { GoogleAdsReportingUnavailable } from './google-ads-reporting-unavailable';

export { GOOGLE_ADS_CONNECT_PATH } from './google-ads-connect-path';

/**
 * Server-reported Google Ads metrics for one selected reporting window.
 *
 * Values are optional on purpose. A missing value means that Google has not
 * supplied that metric yet; the dashboard must not turn it into a misleading
 * zero. CTR is expressed as a percentage (for example, 2.4 means 2.4%).
 */
export interface GoogleAdsReportingMetrics {
  clicks?: number;
  conversions?: number;
  cpc?: number;
  ctr?: number;
  endDate?: string;
  impressions?: number;
  spend?: number;
  startDate?: string;
}
export type GoogleAdsConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'syncing';
export interface GoogleAdsReportingData {
  connectionStatus?: GoogleAdsConnectionStatus;
  currency?: string;
  dataStatus?: 'error' | 'ready';
  error?: string;
  isStale?: boolean;
  lastSyncedAt?: string;
  metrics?: GoogleAdsReportingMetrics;
  needsAccountSelection?: boolean;
  /** A non-sensitive account label supplied by the server. */
  accountName?: string;
}
interface GoogleAdsReportingCardProps {
  canManageIntegrations: boolean;
  className?: string;
  loading?: boolean;
  merchantId?: string;
  onSynced?: () => void;
  reporting?: GoogleAdsReportingData | null;
  syncWindow?: AdsSyncWindow;
}
export function GoogleAdsReportingCard({
  canManageIntegrations,
  className,
  loading = false,
  merchantId,
  onSynced,
  reporting,
  syncWindow,
}: GoogleAdsReportingCardProps) {
  const status =
    reporting?.connectionStatus ??
    (reporting?.metrics ? 'connected' : 'disconnected');
  const currency = reporting?.currency ?? 'USD';
  const metrics = reporting?.metrics;
  const periodLabel = metrics ? formatGoogleAdsReportingWindow(metrics) : null;
  // Older server projections omitted dataStatus. Treat those as usable unless
  // the explicit read-failure sentinel is present, preserving their existing
  // reconnect/account-management behavior.
  const hasReportingReadFailure = reporting?.dataStatus === 'error';
  const hasConfirmedConnectionError =
    status === 'error' && !hasReportingReadFailure;
  const canManageControls = canManageIntegrations && !hasReportingReadFailure;
  return (
    <BentoCard
      className={cn('h-full', className)}
      description="Provider-reported spend and campaign performance"
      icon={BarChart3}
      title="Google Ads reporting"
    >
      {loading || status === 'syncing' ? (
        <div
          className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading Google Ads reporting…
        </div>
      ) : hasReportingReadFailure ? (
        <GoogleAdsReportingUnavailable
          error={reporting?.error}
          onRetry={onSynced}
        />
      ) : hasConfirmedConnectionError ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              {reporting?.error ??
                'Google Ads reporting could not be loaded. Your store analytics are still available.'}
            </AlertDescription>
          </Alert>
          {canManageControls ? (
            <GoogleAdsConnectButton
              label="Reconnect Google Ads"
              merchantId={merchantId}
            />
          ) : null}
        </div>
      ) : status !== 'connected' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect a Google Ads reporting account to bring ad spend,
            impressions, clicks, and conversion metrics into this dashboard.
          </p>
          {canManageIntegrations && (
            <GoogleAdsConnectButton merchantId={merchantId} />
          )}
        </div>
      ) : reporting?.needsAccountSelection ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Google Ads is connected. Select a reporting account to start
            importing spend and campaign metrics.
          </p>
          {canManageControls && (
            <GoogleAdsAccountPicker
              merchantId={merchantId}
              onSynced={onSynced}
              syncWindow={syncWindow}
            />
          )}
        </div>
      ) : !metrics ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <p>
              {reporting?.accountName
                ? `${reporting.accountName} is connected.`
                : 'Google Ads is connected.'}{' '}
              Metrics will appear after the first reporting sync. Select another
              accessible account or retry the sync if needed.
            </p>
          </div>
          {canManageControls && (
            <>
              <GoogleAdsAccountPicker
                merchantId={merchantId}
                onSynced={onSynced}
                syncWindow={syncWindow}
              />
              <GoogleAdsConnectButton
                label="Reconnect Google Ads"
                merchantId={merchantId}
              />
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {reporting.accountName
                ? `Account: ${reporting.accountName}`
                : 'Connected account'}
            </span>
            {periodLabel && <span>Reporting window: {periodLabel}</span>}
          </div>
          <GoogleAdsReportingMetricsGrid
            currency={currency}
            metrics={metrics}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Source: Google Ads reporting</span>
            {reporting.lastSyncedAt && (
              <span>
                Last synced {new Date(reporting.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
          {reporting?.isStale && (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>
                Reporting data may be stale. Sync the selected account to
                refresh provider-reported metrics.
              </AlertDescription>
            </Alert>
          )}
          {canManageControls && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Sync the selected account or choose another accessible Google
                Ads account. Provider-attributed conversions remain separate
                from Baci order attribution and revenue.
              </p>
              <GoogleAdsAccountPicker
                merchantId={merchantId}
                onSynced={onSynced}
                syncWindow={syncWindow}
              />
            </div>
          )}
        </div>
      )}
      {canManageControls && ['connected', 'error'].includes(status) && (
        <AdsDisconnectButton
          displayName="Google Ads"
          merchantId={merchantId}
          onDisconnected={onSynced}
          provider="google"
        />
      )}
    </BentoCard>
  );
}
