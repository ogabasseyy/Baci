'use client';

import { AlertCircle, BarChart3 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BentoCard } from '@/components/ui/bento-card';
import type { AdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import { cn } from '@/lib/utils';
import {
  formatSocialAdsSpend,
  SocialAdsProviderPanel,
} from './social-ads-provider-panel';

export type SocialAdsProvider = 'meta_ads' | 'tiktok_ads' | 'snapchat_ads';
export type SocialAdsConnectionStatus = 'connected' | 'disconnected' | 'error';

interface SpendByCurrency {
  currencyCode: string;
  spendAmountDecimal: string;
}

export interface SocialAdsProviderReporting {
  accountName: string | null;
  accountTimezone: string | null;
  clicksLabel: string;
  connectionStatus: SocialAdsConnectionStatus;
  conversionsLabel: string;
  dataStatus: 'ready' | 'error';
  displayName: string;
  error: string | null;
  freshness: 'fresh' | 'stale' | 'never_synced' | 'not_applicable';
  isStale: boolean;
  lastSyncedAt: string | null;
  metrics: {
    clicks: string;
    conversions: string;
    endDate: string | null;
    impressions: string;
    reach: string | null;
    spendByCurrency: SpendByCurrency[];
    startDate: string | null;
  } | null;
  needsAccountSelection: boolean;
  provider: SocialAdsProvider;
}

export interface SocialAdsReportingData {
  attributionNotice: string;
  mixedCurrencies: boolean;
  providers: SocialAdsProviderReporting[];
  spendByCurrency: SpendByCurrency[];
}

interface SocialAdsReportingCardProps {
  canManageIntegrations: boolean;
  className?: string;
  merchantId?: string;
  onSynced?: () => void;
  reporting?: SocialAdsReportingData | null;
  syncWindow?: AdsSyncWindow;
}

export function SocialAdsReportingCard({
  canManageIntegrations,
  className,
  merchantId,
  onSynced,
  reporting,
  syncWindow,
}: SocialAdsReportingCardProps) {
  return (
    <BentoCard
      className={cn('h-full', className)}
      description="Read-only provider spend and campaign delivery metrics"
      icon={BarChart3}
      title="Social ads reporting"
    >
      {!reporting || reporting.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Social ads reporting is temporarily unavailable.
        </p>
      ) : (
        <div className="space-y-4">
          {reporting.mixedCurrencies && (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>
                Spend uses multiple currencies. Totals are shown separately and
                are never added together.
              </AlertDescription>
            </Alert>
          )}
          {reporting.spendByCurrency.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {reporting.spendByCurrency.map((spend) => (
                <span
                  className="rounded-full bg-muted px-3 py-1"
                  key={spend.currencyCode}
                >
                  Total {formatSocialAdsSpend(spend)}
                </span>
              ))}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-3">
            {reporting.providers.map((provider) => (
              <SocialAdsProviderPanel
                canManageIntegrations={canManageIntegrations}
                key={provider.provider}
                merchantId={merchantId}
                onSynced={onSynced}
                provider={provider}
                syncWindow={syncWindow}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {reporting.attributionNotice} Baci does not calculate social-ad ROAS
            from these provider conversion signals.
          </p>
        </div>
      )}
    </BentoCard>
  );
}
