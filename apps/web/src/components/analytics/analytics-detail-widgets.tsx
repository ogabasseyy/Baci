'use client';

import type {
  MerchantAnalyticsChartPoint,
  MerchantAnalyticsNamedValue,
  MerchantBlogAnalyticsSummary,
  MerchantSupplierAnalyticsRow,
} from '@baci/shared';

import { OrdersChart } from '@/components/analytics/chart-components';
import { BentoCard } from '@/components/ui/bento-card';

export type AnalyticsDetailWidgetId =
  | 'orders-chart'
  | 'brand-breakdown'
  | 'customer-breakdown'
  | 'supplier-breakdown'
  | 'blog-performance';

interface AnalyticsDetailWidgetData {
  blog?: MerchantBlogAnalyticsSummary;
  brandBreakdown?: MerchantAnalyticsNamedValue[];
  chartData?: MerchantAnalyticsChartPoint[];
  customerBreakdown?: MerchantAnalyticsNamedValue[];
  supplierAnalytics?: MerchantSupplierAnalyticsRow[];
}

interface AnalyticsDetailWidgetsProps {
  data: AnalyticsDetailWidgetData;
  formatCurrency: (value: number) => string;
  widgetId: AnalyticsDetailWidgetId;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center text-sm italic text-muted-foreground">
      {label}
    </div>
  );
}

function BreakdownRows({
  rows,
  formatCurrency,
  valueLabel,
}: {
  rows: MerchantAnalyticsNamedValue[];
  formatCurrency: (value: number) => string;
  valueLabel?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState label="No data available for this period" />;
  }

  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3"
          key={row.name}
        >
          <span className="min-w-0 truncate text-sm font-medium">
            {row.name}
          </span>
          <span className="shrink-0 text-right text-sm text-muted-foreground">
            {row.revenue == null
              ? valueLabel
                ? `${row.value.toLocaleString()} ${valueLabel}`
                : row.value.toLocaleString()
              : valueLabel
                ? `${formatCurrency(row.revenue)} · ${row.value.toLocaleString()} ${valueLabel}`
                : formatCurrency(row.revenue)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SupplierRows({
  rows,
  formatCurrency,
}: {
  rows: MerchantSupplierAnalyticsRow[];
  formatCurrency: (value: number) => string;
}) {
  if (rows.length === 0) {
    return <EmptyState label="No supplier cost data available" />;
  }

  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div className="rounded-lg bg-muted/30 p-3" key={row.supplierName}>
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">
              {row.supplierName}
            </span>
            <span className="shrink-0 text-sm font-semibold">
              {formatCurrency(row.grossProfit)} gross profit
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{row.unitCount.toLocaleString()} units</span>
            <span>{formatCurrency(row.totalRevenue)} revenue</span>
            <span>{formatCurrency(row.totalCost)} cost</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartPeriodTotals({
  chartData,
  formatCurrency,
}: {
  chartData: MerchantAnalyticsChartPoint[];
  formatCurrency: (value: number) => string;
}) {
  const totals = chartData.reduce(
    (result, point) => ({
      orders: result.orders + (point.orders ?? 0),
      profit: result.profit + (point.profit ?? 0),
      tax: result.tax + (point.tax ?? 0),
    }),
    { orders: 0, profit: 0, tax: 0 }
  );

  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-muted/30 p-2">
        <p className="text-sm font-semibold tabular-nums">
          {totals.orders.toLocaleString()}
        </p>
        <p className="text-[11px] text-muted-foreground">Orders</p>
      </div>
      <div className="rounded-lg bg-muted/30 p-2">
        <p className="text-sm font-semibold tabular-nums">
          {formatCurrency(totals.profit)}
        </p>
        <p className="text-[11px] text-muted-foreground">Gross profit</p>
      </div>
      <div className="rounded-lg bg-muted/30 p-2">
        <p className="text-sm font-semibold tabular-nums">
          {formatCurrency(totals.tax)}
        </p>
        <p className="text-[11px] text-muted-foreground">Tax</p>
      </div>
    </div>
  );
}

function BlogPerformance({
  blog,
}: {
  blog: MerchantBlogAnalyticsSummary | undefined;
}) {
  if (!blog) {
    return <EmptyState label="No blog analytics available" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Total posts', blog.totalPosts],
          ['Published', blog.publishedPosts],
          ['Drafts', blog.draftPosts],
          ['Total views', blog.totalViews],
        ].map(([label, value]) => (
          <div className="rounded-lg bg-muted/30 p-3 text-center" key={label}>
            <div className="text-xl font-bold">
              {Number(value).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      {blog.topPost ? (
        <div className="rounded-lg bg-primary/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Most viewed post
          </p>
          <p className="mt-1 truncate text-sm font-medium">
            {blog.topPost.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {blog.topPost.viewCount.toLocaleString()} views
          </p>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Publish a post to start tracking content performance.
        </p>
      )}
    </div>
  );
}

/** Renders the base analytics fields that do not belong to a KPI card. */
export function AnalyticsDetailWidgets({
  data,
  formatCurrency,
  widgetId,
}: AnalyticsDetailWidgetsProps) {
  if (widgetId === 'orders-chart') {
    return (
      <div className="min-h-[350px]">
        <BentoCard title="Orders Over Time" className="h-full">
          <OrdersChart data={data.chartData ?? []} />
          <ChartPeriodTotals
            chartData={data.chartData ?? []}
            formatCurrency={formatCurrency}
          />
        </BentoCard>
      </div>
    );
  }

  if (widgetId === 'brand-breakdown') {
    return (
      <div className="min-h-[300px]">
        <BentoCard title="Sales by Brand" className="h-full">
          <BreakdownRows
            formatCurrency={formatCurrency}
            rows={data.brandBreakdown ?? []}
          />
        </BentoCard>
      </div>
    );
  }

  if (widgetId === 'customer-breakdown') {
    return (
      <div className="min-h-[300px]">
        <BentoCard title="Top Customers" className="h-full">
          <BreakdownRows
            formatCurrency={formatCurrency}
            rows={data.customerBreakdown ?? []}
            valueLabel="orders"
          />
        </BentoCard>
      </div>
    );
  }

  if (widgetId === 'supplier-breakdown') {
    return (
      <div className="min-h-[300px]">
        <BentoCard title="Supplier Performance" className="h-full">
          <SupplierRows
            formatCurrency={formatCurrency}
            rows={data.supplierAnalytics ?? []}
          />
        </BentoCard>
      </div>
    );
  }

  return (
    <div className="min-h-[250px]">
      <BentoCard title="Blog Performance" className="h-full">
        <BlogPerformance blog={data.blog} />
      </BentoCard>
    </div>
  );
}
