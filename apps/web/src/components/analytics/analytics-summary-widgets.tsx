import {
  Activity,
  DollarSign,
  Package,
  Percent,
  RefreshCcw,
  ShoppingBag,
  Users,
} from 'lucide-react';
import type { ElementType, ReactNode } from 'react';
import { BentoCard } from '@/components/ui/bento-card';
import { cn } from '@/lib/utils';
import type {
  AnalyticsSummary,
  CurrencyFormatter,
  PercentFormatter,
  WidgetVisibility,
} from './analytics-grid-types';
import { formatMetricChange } from './format-metric-change';

export const EMPTY_ANALYTICS_SUMMARY: AnalyticsSummary = {
  revenue: { value: 0, change: 0 },
  customers: { value: 0, change: 0 },
  sales: { value: 0, change: 0 },
  activeNow: { value: 0, change: 0 },
  aov: { value: 0, change: 0 },
  profit: { value: 0, change: 0 },
  taxDue: { value: 0, change: 0 },
  grossMargin: { value: 0, change: 0 },
  revenuePerCustomer: { value: 0, change: 0 },
  refundRate: { value: 0, change: 0 },
};

interface MetricCardProps {
  change: number;
  icon: ElementType;
  title: string;
  trend: 'up' | 'down';
  value: string;
  widgetId: string;
}

function MetricCard({
  change,
  icon,
  title,
  trend,
  value,
  widgetId,
}: MetricCardProps) {
  return (
    <div key={widgetId} className="min-w-0">
      <BentoCard
        title={title}
        icon={icon}
        className="h-full"
        action={
          <div
            className={cn(
              'flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              trend === 'up'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            )}
          >
            <span>{formatMetricChange(change)}</span>
          </div>
        }
      >
        <div className="min-w-0 space-y-1">
          <div
            className="truncate text-xl font-bold tracking-tight sm:text-2xl"
            title={value}
          >
            {value}
          </div>
        </div>
      </BentoCard>
    </div>
  );
}

interface AnalyticsSummaryWidgetsProps {
  editMode?: boolean;
  formatCurrency: CurrencyFormatter;
  formatPercent: PercentFormatter;
  isWidgetVisible: WidgetVisibility;
  summary: AnalyticsSummary;
}

export function AnalyticsSummaryWidgets({
  editMode = false,
  formatCurrency,
  formatPercent,
  isWidgetVisible,
  summary,
}: AnalyticsSummaryWidgetsProps) {
  const primary: ReactNode[] = [];
  const secondary: ReactNode[] = [];
  const add = (
    target: ReactNode[],
    visible: string,
    props: Omit<MetricCardProps, 'widgetId'>
  ) => {
    if (isWidgetVisible(visible)) {
      target.push(<MetricCard {...props} key={visible} widgetId={visible} />);
    }
  };

  add(primary, 'summary-revenue', {
    title: 'Total Revenue 💰',
    value: formatCurrency(summary.revenue.value),
    change: summary.revenue.change,
    icon: DollarSign,
    trend: summary.revenue.change >= 0 ? 'up' : 'down',
  });
  add(primary, 'summary-orders', {
    title: 'Total Orders 📦',
    value: summary.sales.value.toString(),
    change: summary.sales.change,
    icon: ShoppingBag,
    trend: 'up',
  });
  add(primary, 'summary-profit', {
    title: 'Gross Profit 📈',
    value: formatCurrency(summary.profit?.value || 0),
    change: summary.profit?.change || 0,
    icon: DollarSign,
    trend: (summary.profit?.change || 0) >= 0 ? 'up' : 'down',
  });
  add(primary, 'summary-customers', {
    title: 'Customers 👥',
    value: summary.customers.value.toString(),
    change: summary.customers.change,
    icon: Users,
    trend: 'up',
  });
  add(primary, 'summary-tax', {
    title: 'Tax Due 🏛️',
    value: formatCurrency(summary.taxDue?.value || 0),
    change: Math.abs(summary.taxDue?.change || 0),
    icon: DollarSign,
    trend: (summary.taxDue?.change || 0) <= 0 ? 'up' : 'down',
  });
  add(primary, 'summary-active', {
    title: 'Orders Last Hour 🟢',
    value: summary.activeNow.value.toString(),
    change: summary.activeNow.change,
    icon: Activity,
    trend: 'up',
  });
  add(secondary, 'summary-aov', {
    title: 'Avg. Order Value 🛒',
    value: formatCurrency(summary.aov?.value || 0),
    change: summary.aov?.change || 0,
    icon: DollarSign,
    trend: (summary.aov?.change || 0) >= 0 ? 'up' : 'down',
  });
  add(secondary, 'summary-margin', {
    title: 'Gross Margin % 📊',
    value: formatPercent(summary.grossMargin?.value || 0),
    change: summary.grossMargin?.change || 0,
    icon: Percent,
    trend: (summary.grossMargin?.change || 0) >= 0 ? 'up' : 'down',
  });
  add(secondary, 'summary-refund-rate', {
    title: 'Refund Rate ↩️',
    value: formatPercent(summary.refundRate?.value || 0),
    change: summary.refundRate?.change || 0,
    icon: RefreshCcw,
    trend: (summary.refundRate?.change || 0) <= 0 ? 'up' : 'down',
  });
  add(secondary, 'summary-revenue-per-customer', {
    title: 'Revenue / Customer 💎',
    value: formatCurrency(summary.revenuePerCustomer?.value || 0),
    change: summary.revenuePerCustomer?.change || 0,
    icon: Users,
    trend: (summary.revenuePerCustomer?.change || 0) >= 0 ? 'up' : 'down',
  });
  add(secondary, 'summary-units', {
    title: 'Units Sold 🛒',
    value: (summary.totalUnitsSold || 0).toString(),
    change: 0,
    icon: Package,
    trend: 'up',
  });

  if (editMode) return [...primary, ...secondary];
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {primary}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {secondary}
      </div>
    </>
  );
}
