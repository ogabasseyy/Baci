import { AlertTriangle, Check, RefreshCcw } from 'lucide-react';
import {
  Children,
  type ComponentProps,
  Fragment,
  isValidElement,
  type ReactNode,
} from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { renderAdsAnalyticsWidgets } from './ads-analytics-widgets';
import { AnalyticsBusinessWidgets } from './analytics-business-widgets';
import { AnalyticsDetailWidgetGroup } from './analytics-detail-widget-group';
import type { Layouts } from './analytics-grid-layouts';
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

interface AnalyticsGridEditModeProps
  extends Pick<
    AnalyticsGridProps,
    | 'activeCategory'
    | 'canManageAdsIntegrations'
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
  layouts: Layouts;
  onLayoutChange: ComponentProps<typeof ResponsiveGridLayout>['onLayoutChange'];
  onSave: () => void;
  summary: AnalyticsSummary;
}

export function AnalyticsGridEditMode({
  activeCategory,
  canManageAdsIntegrations,
  categoryError,
  data,
  formatCurrency,
  formatPercent,
  isWidgetVisible,
  layouts,
  merchant,
  onAnalyticsRetry,
  onAdsReportingSynced,
  onLayoutChange,
  onSave,
  summary,
  syncWindow,
}: AnalyticsGridEditModeProps) {
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
    AnalyticsInventoryWidgets({ data, isWidgetVisible }),
    AnalyticsSegmentWidgets({ data, formatCurrency, isWidgetVisible }),
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
    <div className="w-full">
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
        <Button
          aria-label="Save Dashboard Layout"
          className="shrink-0 gap-2"
          onClick={onSave}
          size="sm"
          variant="default"
        >
          <Check className="size-4" />
          Save Layout
        </Button>
      </div>
      <div className="w-full max-w-full overflow-hidden">
        <ResponsiveGridLayout
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          className="layout w-full"
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          draggableHandle=".drag-handle"
          isDraggable
          isResizable
          layouts={layouts}
          margin={[16, 16]}
          onLayoutChange={onLayoutChange}
          rowHeight={150}
        >
          {gridChildren}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
}
