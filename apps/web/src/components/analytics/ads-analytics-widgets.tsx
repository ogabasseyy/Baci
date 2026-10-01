import {
  AlertTriangle,
  BarChart3,
  Check,
  MousePointerClick,
  Shield,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { AnalyticsData } from '@/components/analytics/draggable-analytics-grid';
import { GoogleAdsReportingCard } from '@/components/analytics/google-ads-reporting-card';
import { SocialAdsReportingCard } from '@/components/analytics/social-ads-reporting-card';
import { BentoCard } from '@/components/ui/bento-card';
import type { AdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import { cn } from '@/lib/utils';

interface AdsAnalyticsWidgetsProps {
  adAnalytics: AnalyticsData['adAnalytics'];
  canManageIntegrations: boolean;
  editMode?: boolean;
  formatCurrency: (value: number) => string;
  isWidgetVisible: (widgetId: string) => boolean;
  merchantId?: string;
  onAdsReportingSynced?: () => void;
  syncWindow?: AdsSyncWindow;
}
const LoadingState = () => (
  <div className="flex items-center justify-center h-full">
    <p className="text-muted-foreground">Loading…</p>
  </div>
);
export function renderAdsAnalyticsWidgets({
  adAnalytics,
  canManageIntegrations,
  editMode,
  formatCurrency,
  isWidgetVisible,
  merchantId,
  onAdsReportingSynced,
  syncWindow,
}: AdsAnalyticsWidgetsProps): ReactNode[] {
  const renderWidget = (
    widgetId: string,
    content: ReactNode,
    className: string
  ) =>
    isWidgetVisible(widgetId) ? (
      <div className={className} key={widgetId}>
        {content}
      </div>
    ) : null;
  const widgets = [
    renderWidget(
      'ads-overview',
      <BentoCard title="Conversion Overview" icon={Zap} className="h-full">
        {adAnalytics ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Conversions Tracked
                </p>
                <p className="text-3xl font-bold">
                  {adAnalytics.summary.totalConversions}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">
                  Attributed Revenue
                </p>
                <p className="text-xl font-bold text-green-500">
                  {formatCurrency(adAnalytics.summary.totalAttributedRevenue)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-2xl font-bold">
                  {adAnalytics.configuredPlatforms}
                </div>
                <div className="text-xs text-muted-foreground">
                  Platforms Active
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 text-center">
                <div className="text-2xl font-bold">
                  {adAnalytics.summary.totalOrders}
                </div>
                <div className="text-xs text-muted-foreground">
                  Total Orders
                </div>
              </div>
            </div>
            <div
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg text-sm',
                adAnalytics.offlineConversionsEnabled
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-amber-500/10 text-amber-600'
              )}
            >
              {adAnalytics.offlineConversionsEnabled ? (
                <>
                  <Check className="size-4" />
                  <span>Offline conversions enabled</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-4" />
                  <span>Offline conversions disabled</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <LoadingState />
        )}
      </BentoCard>,
      'min-h-[300px]'
    ),
    renderWidget(
      'ads-platforms',
      <BentoCard
        title="Platform Performance"
        icon={BarChart3}
        className="h-full"
      >
        {adAnalytics ? (
          <div className="space-y-3">
            {adAnalytics.platforms.map((platform) => (
              <div
                key={platform.name}
                className={cn(
                  'p-3 rounded-lg',
                  platform.configured ? 'bg-muted/30' : 'bg-muted/10 opacity-60'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{platform.name}</span>
                    {platform.configured ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Not configured
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-bold">
                    {platform.conversions} conversions
                  </span>
                </div>
                {platform.configured && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Revenue: {formatCurrency(platform.revenue)}</span>
                    <span>{platform.clickAttributed} click-attributed</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <LoadingState />
        )}
      </BentoCard>,
      'min-h-[300px]'
    ),
    renderWidget(
      'ads-attribution',
      <BentoCard
        title="Click Attribution"
        icon={MousePointerClick}
        className="h-full"
      >
        {adAnalytics ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Orders tracked with ad click IDs for better attribution
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="p-3 rounded-lg bg-blue-500/10 text-center">
                <div className="text-xl font-bold text-blue-600">
                  {adAnalytics.summary.trackingRate}%
                </div>
                <div className="text-xs text-muted-foreground">
                  Tracking Rate
                </div>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10 text-center">
                <div className="text-xl font-bold text-purple-600">
                  {adAnalytics.summary.clickAttributionRate}%
                </div>
                <div className="text-xs text-muted-foreground">
                  Click Attribution
                </div>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 text-center">
                <div className="text-xl font-bold text-green-600">
                  {adAnalytics.details.ordersWithClickIds}
                </div>
                <div className="text-xs text-muted-foreground">
                  With Click IDs
                </div>
              </div>
              <div className="p-3 rounded-lg bg-emerald-500/10 text-center">
                <div className="text-xl font-bold text-emerald-600">
                  {adAnalytics.details.ordersWithTracking}
                </div>
                <div className="text-xs text-muted-foreground">
                  With Tracking
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-4">
              Click IDs (fbclid, ttclid, gclid, sccid) help platforms attribute
              conversions to the original ad click for better attribution. Ad
              spend and ROAS appear after a reporting account is connected.
            </div>
          </div>
        ) : (
          <LoadingState />
        )}
      </BentoCard>,
      'min-h-[250px]'
    ),
    renderWidget(
      'ads-privacy',
      <BentoCard title="Privacy Compliance" icon={Shield} className="h-full">
        {adAnalytics ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              CCPA/GDPR compliance through Limited Data Use (LDU)
            </p>
            <div className="p-4 rounded-lg bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm">Orders with LDU flag</span>
                <span className="text-lg font-bold">
                  {adAnalytics.details.ordersWithLDU}
                </span>
              </div>
              <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{
                    width: `${Math.min(adAnalytics.summary.lduRate, 100)}%`,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {adAnalytics.summary.lduRate}% of tracked orders
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              LDU is automatically applied for users in California (CCPA), EU
              countries (GDPR), and other privacy-focused regions.
            </div>
          </div>
        ) : (
          <LoadingState />
        )}
      </BentoCard>,
      'min-h-[250px]'
    ),
    renderWidget(
      'ads-reporting',
      <GoogleAdsReportingCard
        canManageIntegrations={canManageIntegrations}
        merchantId={merchantId}
        onSynced={onAdsReportingSynced}
        reporting={adAnalytics?.googleAds}
        syncWindow={syncWindow}
      />,
      cn('min-h-[300px]', !editMode && 'lg:col-span-2')
    ),
    renderWidget(
      'social-ads-reporting',
      <SocialAdsReportingCard
        canManageIntegrations={canManageIntegrations}
        merchantId={merchantId}
        onSynced={onAdsReportingSynced}
        reporting={adAnalytics?.socialAds}
        syncWindow={syncWindow}
      />,
      cn('min-h-[300px]', !editMode && 'lg:col-span-2')
    ),
  ];
  return editMode
    ? widgets
    : [
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full"
          key="ads-widgets"
        >
          {widgets}
        </div>,
      ];
}
