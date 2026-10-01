import { AlertTriangle, RefreshCcw, Settings2 } from 'lucide-react';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { renderAdsAnalyticsWidgets } from './ads-analytics-widgets';
import { AnalyticsBusinessWidgets } from './analytics-business-widgets';
import { AnalyticsDetailWidgetGroup } from './analytics-detail-widget-group';
import { type Layouts, resolveCategoryLayouts } from './analytics-grid-layouts';
import type {
  AnalyticsGridProps,
  AnalyticsSummary,
  CurrencyFormatter,
  PercentFormatter,
  WidgetVisibility,
} from './analytics-grid-types';
import { AnalyticsInventoryWidgets } from './analytics-inventory-widgets';
import { AnalyticsSalesWidgets } from './analytics-sales-widgets';
import { AnalyticsSegmentWidgets } from './analytics-segment-widgets';
import { AnalyticsSummaryWidgets } from './analytics-summary-widgets';

const ResponsiveGridLayout = WidthProvider(Responsive);

function flattenGridChildren(node: ReactNode): ReactNode[] {
  const children: ReactNode[] = [];
  Children.forEach(node, (child) => {
    if (
      isValidElement<{ children?: ReactNode }>(child) &&
      child.type === Fragment
    ) {
      children.push(...flattenGridChildren(child.props.children));
    } else if (child !== null && child !== false) {
      children.push(child);
    }
  });
  return children;
}

interface AnalyticsGridViewModeProps
  extends Pick<
    AnalyticsGridProps,
    | 'activeCategory'
    | 'canManageAdsIntegrations'
    | 'canCustomizeLayout'
    | 'categoryError'
    | 'data'
    | 'merchant'
    | 'onAnalyticsRetry'
    | 'onAdsReportingSynced'
    | 'syncWindow'
  > {
  formatCurrency: CurrencyFormatter;
  formatPercent: PercentFormatter;
  isWidgetVisible: WidgetVisibility;
  layouts?: Layouts;
  onEdit: () => void;
  summary: AnalyticsSummary;
}

export function AnalyticsGridViewMode({
  activeCategory,
  canManageAdsIntegrations,
  canCustomizeLayout,
  categoryError,
  data,
  formatCurrency,
  formatPercent,
  isWidgetVisible,
  layouts,
  merchant,
  onAnalyticsRetry,
  onAdsReportingSynced,
  onEdit,
  summary,
  syncWindow,
}: AnalyticsGridViewModeProps) {
  const effectiveLayouts = layouts ?? resolveCategoryLayouts(activeCategory);
  const gridChildren = flattenGridChildren([
    AnalyticsSummaryWidgets({
      editMode: true,
      formatCurrency,
      formatPercent,
      isWidgetVisible,
      summary,
    }),
    AnalyticsBusinessWidgets({
      data,
      editMode: true,
      formatCurrency,
      isWidgetVisible,
      summary,
    }),
    AnalyticsDetailWidgetGroup({
      data,
      formatCurrency,
      isWidgetVisible,
    }),
    AnalyticsSalesWidgets({
      data,
      editMode: true,
      formatCurrency,
      isWidgetVisible,
    }),
    activeCategory === 'inventory'
      ? AnalyticsInventoryWidgets({ data, isWidgetVisible })
      : null,
    activeCategory === 'segments'
      ? AnalyticsSegmentWidgets({ data, formatCurrency, isWidgetVisible })
      : null,
    activeCategory === 'ads'
      ? renderAdsAnalyticsWidgets({
          adAnalytics: data.adAnalytics,
          canManageIntegrations: canManageAdsIntegrations,
          editMode: true,
          formatCurrency,
          isWidgetVisible,
          merchantId: merchant?.id,
          onAdsReportingSynced,
          syncWindow,
        })
      : null,
  ]);

  return (
    <div className="w-full max-w-full space-y-4 overflow-hidden">
      {categoryError && (
        <Alert className="mb-4" variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            <p>{categoryError}</p>
            {onAnalyticsRetry && (
              <Button
                className="mt-2"
                onClick={onAnalyticsRetry}
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCcw className="size-4" />
                Retry analytics
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-4 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        {canCustomizeLayout && (
          <Button
            aria-label="Customize Dashboard Layout"
            className="shrink-0 gap-2"
            onClick={onEdit}
            size="sm"
            variant="outline"
          >
            <Settings2 className="size-4" />
            Customize Dashboard
          </Button>
        )}
      </div>
      <div className="w-full max-w-full overflow-hidden">
        <ResponsiveGridLayout
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          className="layout w-full"
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          draggableHandle=".drag-handle"
          isDraggable={false}
          isResizable={false}
          layouts={effectiveLayouts}
          margin={[16, 16]}
          rowHeight={150}
        >
          {gridChildren}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
}
