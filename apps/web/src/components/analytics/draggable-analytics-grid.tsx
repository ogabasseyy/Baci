'use client';

import { useEffect, useState } from 'react';
import { AIInsightsPanel } from './ai-insights-panel';
import { AnalyticsGridEditMode } from './analytics-grid-edit-mode';
import { createAnalyticsFormatters } from './analytics-grid-formatters';
import { ANALYTICS_WIDGET_IDS_BY_CATEGORY } from './analytics-grid-layouts';
import type { AnalyticsGridProps } from './analytics-grid-types';
import { AnalyticsGridViewMode } from './analytics-grid-view-mode';
import { EMPTY_ANALYTICS_SUMMARY } from './analytics-summary-widgets';
import { useAnalyticsGridLayout } from './use-analytics-grid-layout';

export { formatTopProductUnits } from './analytics-grid-formatters';
export type {
  AdAnalyticsData,
  AdAnalyticsDetails,
  AdAnalyticsSummary,
  AdPlatformData,
  AnalyticsData,
  InventoryAlert,
  InventoryForecast,
  InventoryForecastStatus,
  SegmentInfo,
  SegmentSummary,
} from './analytics-grid-types';

function loadGridLayoutStyles(): void {
  import('react-grid-layout/css/styles.css');
  import('react-resizable/css/styles.css');
}

function AnalyticsGridLoading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton slots
            key={index}
            className="relative h-32 overflow-hidden rounded-2xl border border-border/50 bg-muted/10"
          >
            <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/5 to-transparent" />
            <div className="space-y-2 p-4">
              <div className="h-3 w-20 rounded bg-muted/30" />
              <div className="h-6 w-24 rounded bg-muted/20" />
            </div>
          </div>
        ))}
        <div className="relative col-span-1 h-80 overflow-hidden rounded-2xl border border-border/50 bg-muted/10 md:col-span-3">
          <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/5 to-transparent" />
        </div>
        <div className="relative col-span-1 h-80 overflow-hidden rounded-2xl border border-border/50 bg-muted/10">
          <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/5 to-transparent" />
        </div>
      </div>
    </div>
  );
}

export function DraggableAnalyticsGrid({
  activeCategory,
  canManageAdsIntegrations,
  canCustomizeLayout,
  categoryError,
  data,
  loading,
  merchant,
  onAnalyticsRetry,
  onAdsReportingSynced,
  syncWindow,
}: AnalyticsGridProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const { layouts, onLayoutChange } = useAnalyticsGridLayout({
    activeCategory,
    isEditMode,
    merchantId: merchant?.id,
  });

  useEffect(() => {
    loadGridLayoutStyles();
  }, []);

  const insightsPanel = (
    <div className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
      <div className="w-full min-w-0 flex-1">
        <AIInsightsPanel
          activeCategory={activeCategory}
          merchantId={merchant?.id}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="w-full">
        {insightsPanel}
        <AnalyticsGridLoading />
      </div>
    );
  }

  const summary = data.summary ?? EMPTY_ANALYTICS_SUMMARY;
  const { formatCurrency, formatPercent } = createAnalyticsFormatters(merchant);
  const isWidgetVisible = (key: string) =>
    ANALYTICS_WIDGET_IDS_BY_CATEGORY[activeCategory]?.includes(key) ?? false;
  const sharedProps = {
    activeCategory,
    canManageAdsIntegrations,
    canCustomizeLayout,
    categoryError,
    data,
    formatCurrency,
    formatPercent,
    isWidgetVisible,
    merchant,
    onAnalyticsRetry,
    onAdsReportingSynced,
    summary,
    syncWindow,
  };

  if (!isEditMode) {
    return (
      <div className="w-full">
        {insightsPanel}
        <AnalyticsGridViewMode
          {...sharedProps}
          layouts={layouts}
          onEdit={() => setIsEditMode(true)}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      {insightsPanel}
      <AnalyticsGridEditMode
        {...sharedProps}
        layouts={layouts}
        onLayoutChange={onLayoutChange}
        onSave={() => setIsEditMode(false)}
      />
    </div>
  );
}
