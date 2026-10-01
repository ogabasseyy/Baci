import { BentoCard } from '@/components/ui/bento-card';
import { cn } from '@/lib/utils';
import { formatTopProductUnits } from './analytics-grid-formatters';
import type {
  AnalyticsData,
  CurrencyFormatter,
  WidgetVisibility,
} from './analytics-grid-types';
import { RevenueChart, SalesByChannelChart } from './chart-components';

const PAYMENT_COLORS = [
  'bg-primary',
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-slate-500',
];

interface AnalyticsSalesWidgetsProps {
  data: AnalyticsData;
  editMode?: boolean;
  formatCurrency: CurrencyFormatter;
  isWidgetVisible: WidgetVisibility;
  viewSection?: 'all' | 'charts' | 'lists';
}

function PaymentMethods({
  data,
  formatCurrency,
}: Pick<AnalyticsSalesWidgetsProps, 'data' | 'formatCurrency'>) {
  const paymentMethods = data.salesByPaymentMethod ?? [];
  const totalValue = paymentMethods.reduce(
    (total, method) => total + method.value,
    0
  );
  return (
    <BentoCard title="Payment Methods 💳" className="h-full">
      <div className="space-y-4">
        {paymentMethods.length ? (
          paymentMethods.map((method, index) => {
            const percentage = totalValue
              ? Math.round((method.value / totalValue) * 100)
              : 0;
            return (
              <div key={method.name} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{method.name}</span>
                  <span className="font-medium">
                    {formatCurrency(method.value)} · {percentage}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full',
                      PAYMENT_COLORS[index % PAYMENT_COLORS.length]
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-sm italic text-muted-foreground">
            No payment data available
          </div>
        )}
      </div>
    </BentoCard>
  );
}

function RecentSales({
  data,
  editMode,
  formatCurrency,
}: Pick<AnalyticsSalesWidgetsProps, 'data' | 'editMode' | 'formatCurrency'>) {
  return (
    <BentoCard
      title={editMode ? 'Recent Sales' : 'Recent Sales 🛍️'}
      className="h-full"
    >
      <div className="custom-scrollbar max-h-[250px] space-y-4 overflow-y-auto pr-2">
        {data.recentSales?.map((sale) => (
          <div
            key={sale.id}
            className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xs font-bold text-primary">
                  {sale.name.charAt(0)}
                </span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{sale.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {sale.email}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-bold">
                {formatCurrency(sale.amount)}
              </div>
              <div className="text-xs text-muted-foreground">{sale.time}</div>
            </div>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

function TopProducts({
  data,
  editMode,
  formatCurrency,
}: Pick<AnalyticsSalesWidgetsProps, 'data' | 'editMode' | 'formatCurrency'>) {
  return (
    <BentoCard
      title={editMode ? 'Top Products 🏆' : 'Top Products 🔥'}
      className="h-full"
    >
      <div className="custom-scrollbar max-h-[250px] space-y-4 overflow-y-auto pr-2">
        {data.topProducts?.map((product, index) => (
          <div
            key={product.id}
            className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary/10">
                <span className="text-xs font-bold text-secondary-foreground">
                  #{index + 1}
                </span>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {product.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTopProductUnits(product.units)}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-bold">
                {formatCurrency(product.revenue)}
              </div>
              {(product.units ?? 0) > 0 && (
                <div className="text-xs text-muted-foreground">
                  {product.units} units
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

function SalesWidgetContent({
  data,
  formatCurrency,
  isWidgetVisible,
}: AnalyticsSalesWidgetsProps) {
  return (
    <>
      {isWidgetVisible('revenue-chart') && (
        <div key="revenue-chart">
          <BentoCard title="Revenue Over Time" className="h-full">
            <RevenueChart
              data={data.chartData || []}
              valueFormatter={formatCurrency}
            />
          </BentoCard>
        </div>
      )}
      {isWidgetVisible('payment-methods') && (
        <div key="payment-methods">
          <PaymentMethods data={data} formatCurrency={formatCurrency} />
        </div>
      )}
      {isWidgetVisible('sales-channel') && (
        <div key="sales-channel">
          <BentoCard title="Sales by Channel 📊" className="h-full">
            <SalesByChannelChart
              data={data.salesByChannel || []}
              valueFormatter={formatCurrency}
            />
          </BentoCard>
        </div>
      )}
      {isWidgetVisible('recent-sales') && (
        <div key="recent-sales">
          <RecentSales data={data} editMode formatCurrency={formatCurrency} />
        </div>
      )}
      {isWidgetVisible('top-products') && (
        <div key="top-products">
          <TopProducts data={data} editMode formatCurrency={formatCurrency} />
        </div>
      )}
    </>
  );
}

export function AnalyticsSalesWidgets(props: AnalyticsSalesWidgetsProps) {
  if (props.editMode) return SalesWidgetContent(props);
  const { data, formatCurrency, isWidgetVisible, viewSection = 'all' } = props;
  const showCharts = viewSection === 'all' || viewSection === 'charts';
  const showLists = viewSection === 'all' || viewSection === 'lists';
  return (
    <>
      {showCharts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {isWidgetVisible('revenue-chart') && (
            <div className="min-h-[400px] lg:col-span-2">
              <BentoCard title="Revenue Over Time" className="h-full">
                <RevenueChart
                  data={data.chartData || []}
                  valueFormatter={formatCurrency}
                />
              </BentoCard>
            </div>
          )}
          {isWidgetVisible('payment-methods') && (
            <div className="min-h-[400px]">
              <PaymentMethods data={data} formatCurrency={formatCurrency} />
            </div>
          )}
        </div>
      )}
      {showLists && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {isWidgetVisible('sales-channel') && (
            <div className="min-h-[350px]">
              <BentoCard title="Sales by Channel 📊" className="h-full">
                <SalesByChannelChart
                  data={data.salesByChannel || []}
                  valueFormatter={formatCurrency}
                />
              </BentoCard>
            </div>
          )}
          {isWidgetVisible('recent-sales') && (
            <div className="min-h-[350px]">
              <RecentSales data={data} formatCurrency={formatCurrency} />
            </div>
          )}
        </div>
      )}
      {showLists && isWidgetVisible('top-products') && (
        <div className="w-full">
          <TopProducts data={data} formatCurrency={formatCurrency} />
        </div>
      )}
    </>
  );
}
