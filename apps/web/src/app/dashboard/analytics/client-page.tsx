'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  type AnalyticsCategory,
  AnalyticsCategoryNav,
  VALID_CATEGORIES,
} from '@/components/analytics/analytics-category-nav';
import { isAnalyticsCategoryAllowed } from '@/components/analytics/analytics-category-permissions';
import { AnalyticsFilters } from '@/components/analytics/analytics-filters';
import {
  type AnalyticsData,
  DraggableAnalyticsGrid,
} from '@/components/analytics/draggable-analytics-grid';
import { BagLoader } from '@/components/ui/bag-loader';
import { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { buildAdsSyncWindow } from '@/lib/analytics/default-ads-sync-window';
import { loadAnalyticsExport } from './load-analytics-export';
import { mergeAnalyticsData } from './merge-analytics-data';
import { useMerchantBoundBaseAnalytics } from './use-merchant-bound-base-analytics';
import { useMerchantBoundCategoryAnalytics } from './use-merchant-bound-category-analytics';
import { useSelectedAnalyticsMerchant } from './use-selected-analytics-merchant';

export default function AnalyticsClientPage() {
  const { toast } = useToast();
  const { hasPermission, merchant, loading: merchantLoading } = useMerchant();
  const [date, setDate] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: new Date(new Date().setDate(new Date().getDate() - 7)),
    to: new Date(),
  });
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');
  const cacheBustParam = searchParams.get('cacheBust');
  const merchantIdParam = searchParams.get('merchantId');
  const callbackReason = searchParams.get('reason');
  const callbackProvider = [
    ['google_ads', 'Google Ads'],
    ['meta_ads', 'Meta Ads'],
    ['tiktok_ads', 'TikTok Ads'],
    ['snapchat_ads', 'Snapchat Ads'],
  ].find(([parameter]) => searchParams.get(parameter ?? '') === 'error');
  const initialAnalyticsRefreshKey =
    cacheBustParam && /^\d{1,10}$/.test(cacheBustParam)
      ? Number(cacheBustParam)
      : 0;
  const requestedCategory =
    categoryParam &&
    VALID_CATEGORIES.includes(categoryParam as AnalyticsCategory)
      ? (categoryParam as AnalyticsCategory)
      : 'overview';
  const [activeCategory, setActiveCategory] =
    useState<AnalyticsCategory>(requestedCategory);
  const [analyticsRefreshKey, setAnalyticsRefreshKey] = useState(
    initialAnalyticsRefreshKey
  );
  const requestedMerchantId =
    merchantIdParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      merchantIdParam
    )
      ? merchantIdParam
      : null;
  const selectedContext = useSelectedAnalyticsMerchant({
    defaultHasPermission: hasPermission,
    defaultMerchant: merchant,
    requestedMerchantId,
  });
  const selectedMerchantId = selectedContext.merchant?.id;
  const effectiveCategory = isAnalyticsCategoryAllowed(
    activeCategory,
    selectedContext.hasPermission
  )
    ? activeCategory
    : 'overview';
  const {
    data: baseAnalytics,
    error: baseAnalyticsError,
    loading: loadingAnalytics,
  } = useMerchantBoundBaseAnalytics({
    from: date.from,
    merchantId: selectedMerchantId,
    refreshKey: analyticsRefreshKey,
    to: date.to,
  });
  const {
    data: categoryAnalytics,
    error: categoryAnalyticsError,
    loading: loadingCategoryAnalytics,
  } = useMerchantBoundCategoryAnalytics({
    allowed: isAnalyticsCategoryAllowed(
      effectiveCategory,
      selectedContext.hasPermission
    ),
    category: effectiveCategory,
    from: date.from,
    merchantId: selectedMerchantId,
    refreshKey: analyticsRefreshKey,
    to: date.to,
  });
  useEffect(() => {
    if (!callbackProvider) return;
    toast({
      description: callbackReason
        ? `Reason: ${callbackReason.replaceAll('_', ' ')}`
        : 'Please try connecting again.',
      title: `${callbackProvider[1]} connection failed`,
      variant: 'destructive',
    });
  }, [callbackProvider?.[0], callbackReason, toast]);
  const analyticsData: AnalyticsData | null = mergeAnalyticsData(
    baseAnalytics,
    categoryAnalytics ?? {}
  );

  const visibleCategories = VALID_CATEGORIES.filter((category) =>
    isAnalyticsCategoryAllowed(category, selectedContext.hasPermission)
  );

  const handleAdsReportingSynced = () => {
    setAnalyticsRefreshKey((currentKey) => currentKey + 1);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!analyticsData) {
      toast({
        title: 'No data to export',
        description: 'Please wait for analytics data to load.',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (format === 'csv') {
        const { exportAnalyticsAsCSV } = await loadAnalyticsExport();
        exportAnalyticsAsCSV(
          analyticsData,
          date,
          selectedContext.merchant?.business_name,
          effectiveCategory
        );
        toast({
          title: 'CSV Exported',
          description: 'Your analytics report has been downloaded as CSV.',
        });
      } else {
        const { exportAnalyticsAsPDF } = await loadAnalyticsExport();
        exportAnalyticsAsPDF(
          analyticsData,
          date,
          selectedContext.merchant?.business_name,
          effectiveCategory
        );
        toast({
          title: 'PDF Exported',
          description: 'Your analytics report has been downloaded as PDF.',
        });
      }
    } catch (error) {
      toast({
        title: 'Export Failed',
        description:
          'There was an error exporting your report. Please try again.',
        variant: 'destructive',
      });
      console.error('Export error:', error);
    }
  };

  if (merchantLoading || selectedContext.loading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <BagLoader size={32} />
      </div>
    );
  }

  if (selectedContext.error) {
    return (
      <div
        className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive"
        role="alert"
      >
        {selectedContext.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 relative overflow-hidden max-w-full min-w-0">
      <div className="absolute inset-0 w-full h-full bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/10 via-background to-background -z-10 pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('/grid.svg')] bg-center mask-[linear-gradient(180deg,white,rgba(255,255,255,0))] -z-10 pointer-events-none opacity-50" />

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-linear-to-r from-primary via-purple-500 to-blue-600 bg-clip-text text-transparent">
            Analytics 📈
          </h1>
          <p className="text-muted-foreground">
            Deep dive into your store's performance.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sticky top-0 z-10 py-4 bg-background/60 backdrop-blur-xl -mx-6 px-6 border-b border-white/10">
        <AnalyticsCategoryNav
          activeCategory={effectiveCategory}
          onCategoryChange={setActiveCategory}
          visibleCategories={visibleCategories}
        />
        <AnalyticsFilters
          category={effectiveCategory}
          date={date}
          onDateChange={setDate}
          onExport={handleExport}
        />
      </div>

      <DraggableAnalyticsGrid
        canManageAdsIntegrations={selectedContext.hasPermission(
          'integrations',
          'manage'
        )}
        canCustomizeLayout={selectedContext.hasPermission('settings', 'edit')}
        data={analyticsData || {}}
        loading={loadingAnalytics || loadingCategoryAnalytics}
        activeCategory={effectiveCategory}
        merchant={selectedContext.merchant}
        categoryError={baseAnalyticsError ?? categoryAnalyticsError}
        onAnalyticsRetry={handleAdsReportingSynced}
        onAdsReportingSynced={handleAdsReportingSynced}
        syncWindow={
          date.from && date.to
            ? buildAdsSyncWindow(date.from, date.to)
            : undefined
        }
      />
    </div>
  );
}
