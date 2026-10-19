import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import { adminOverviewUtils } from './admin-overview-utils';

interface AdminOverviewChartsProps {
  analytics: PlatformAnalytics | null;
  loading: boolean;
}

function GmvTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ value?: number }>;
}) {
  if (!(active && payload?.length)) return null;

  return (
    <div className="rounded-xl border bg-background/95 backdrop-blur-xs p-3 shadow-xl">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold">
        {adminOverviewUtils.formatCurrency(payload[0].value ?? 0)}
      </p>
    </div>
  );
}

export function AdminOverviewCharts({
  analytics,
  loading,
}: AdminOverviewChartsProps) {
  const chartData = adminOverviewUtils.getChartData(analytics);

  return (
    <Card className="glass lg:col-span-2">
      <CardHeader>
        <CardTitle>NGN Paid GMV Over Time</CardTitle>
        <CardDescription>
          Daily paid GMV from NGN-denominated orders; non-NGN/unknown-currency
          orders are excluded
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer
              debounce={100}
              height="100%"
              minHeight={0}
              minWidth={0}
              width="100%"
            >
              <AreaChart
                data={chartData}
                margin={{ bottom: 0, left: -20, right: 10, top: 10 }}
              >
                <defs>
                  <linearGradient id="colorGmv" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  className="text-muted/20"
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  className="text-muted-foreground"
                  dataKey="date"
                  fontSize={12}
                  stroke="currentColor"
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  className="text-muted-foreground"
                  fontSize={12}
                  stroke="currentColor"
                  tickFormatter={adminOverviewUtils.formatCurrency}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, label, payload }) => (
                    <GmvTooltip
                      active={active}
                      label={
                        typeof label === 'string' || typeof label === 'number'
                          ? String(label)
                          : undefined
                      }
                      payload={payload?.map((entry) => ({
                        value:
                          typeof entry.value === 'number'
                            ? entry.value
                            : undefined,
                      }))}
                    />
                  )}
                />
                <Area
                  dataKey="gmv"
                  fill="url(#colorGmv)"
                  fillOpacity={1}
                  stroke="#6366f1"
                  strokeWidth={3}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
