import { BentoCard } from '@/components/ui/bento-card';
import type {
  AnalyticsData,
  AnalyticsSummary,
  CurrencyFormatter,
  WidgetVisibility,
} from './analytics-grid-types';

interface AnalyticsBusinessWidgetsProps {
  data: AnalyticsData;
  editMode?: boolean;
  formatCurrency: CurrencyFormatter;
  isWidgetVisible: WidgetVisibility;
  summary: AnalyticsSummary;
}

function Highlights({
  data,
  formatCurrency,
}: Pick<AnalyticsBusinessWidgetsProps, 'data' | 'formatCurrency'>) {
  return (
    <BentoCard title="Business Highlights ✨" className="h-full w-full">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top brand
          </p>
          <p className="mt-2 truncate text-lg font-bold">
            {data.topBrand?.name || 'No brand data'}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.topBrand
              ? formatCurrency(data.topBrand.revenue ?? data.topBrand.value)
              : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top supplier
          </p>
          <p className="mt-2 truncate text-lg font-bold">
            {data.topSupplier?.supplierName || 'No supplier data'}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.topSupplier
              ? `${formatCurrency(data.topSupplier.grossProfit)} gross profit`
              : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-blue-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Blog views
          </p>
          <p className="mt-2 text-lg font-bold">
            {(data.blog?.totalViews || 0).toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.blog?.publishedPosts || 0} published posts
          </p>
        </div>
        <div className="rounded-xl bg-amber-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top payment method
          </p>
          <p className="mt-2 truncate text-lg font-bold">
            {data.topPaymentMethod?.name || 'No payment data'}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.topPaymentMethod
              ? `${data.topPaymentMethod.value.toFixed(1)}% of payment revenue`
              : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-violet-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top customer
          </p>
          <p className="mt-2 truncate text-lg font-bold">
            {data.topCustomer?.name || 'No customer data'}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.topCustomer
              ? `${formatCurrency(data.topCustomer.revenue ?? 0)} revenue`
              : '—'}
          </p>
        </div>
      </div>
    </BentoCard>
  );
}

function FinancialSummary({
  formatCurrency,
  summary,
}: Pick<AnalyticsBusinessWidgetsProps, 'formatCurrency' | 'summary'>) {
  return (
    <BentoCard title="Financial Position 🏦" className="h-full">
      <div className="grid grid-cols-1 gap-6 rounded-2xl bg-slate-900 p-4 text-white md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Subtotal
          </p>
          <p className="text-2xl font-bold">
            {formatCurrency(summary.subtotal || 0)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Shipping
          </p>
          <p className="text-2xl font-bold text-blue-400">
            {formatCurrency(summary.shipping || 0)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Tax (VAT)
          </p>
          <p className="text-2xl font-bold text-purple-400">
            {formatCurrency(summary.tax || 0)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Discounts
          </p>
          <p className="text-2xl font-bold text-red-400">
            -{formatCurrency(summary.discounts || 0)}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border/50 p-4">
        <span className="text-lg font-bold">Net Sales</span>
        <span className="text-2xl font-black text-primary">
          {formatCurrency(summary.revenue.value)}
        </span>
      </div>
    </BentoCard>
  );
}

export function AnalyticsBusinessWidgets({
  data,
  editMode = false,
  formatCurrency,
  isWidgetVisible,
  summary,
}: AnalyticsBusinessWidgetsProps) {
  return (
    <>
      {isWidgetVisible('analytics-highlights') && (
        <div
          key="analytics-highlights"
          className={editMode ? undefined : 'w-full'}
        >
          <Highlights data={data} formatCurrency={formatCurrency} />
        </div>
      )}
      {isWidgetVisible('financial-summary') && (
        <div
          key="financial-summary"
          className={editMode ? undefined : 'w-full'}
        >
          <FinancialSummary formatCurrency={formatCurrency} summary={summary} />
        </div>
      )}
    </>
  );
}
