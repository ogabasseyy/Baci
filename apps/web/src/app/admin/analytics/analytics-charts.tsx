import { BarChart3 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { formatAnalyticsCurrency } from './analytics-format';

type AnalyticsChartDatum = {
  date: string;
  gmv: number;
  orders: number;
};

type AnalyticsChartsProps = {
  chartData: AnalyticsChartDatum[];
  loading: boolean;
};

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
        {formatAnalyticsCurrency(payload[0].value ?? 0)}
      </p>
    </div>
  );
}

function OrdersTooltip({
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
      <p className="text-lg font-bold">{payload[0].value ?? 0} orders</p>
    </div>
  );
}

export function AnalyticsCharts({ chartData, loading }: AnalyticsChartsProps) {
  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-5" />
            NGN GMV by Order-Created Date
          </CardTitle>
          <CardDescription>
            Daily NGN paid GMV by order-created date; non-NGN/unknown-currency
            orders are excluded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer
                width="100%"
                height="100%"
                debounce={100}
                minWidth={0}
                minHeight={0}
              >
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorGmv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="currentColor"
                    className="text-muted/20"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="currentColor"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="currentColor"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatAnalyticsCurrency}
                  />
                  <Tooltip
                    content={(props) => (
                      <GmvTooltip
                        active={props.active}
                        label={props.label?.toString()}
                        payload={props.payload?.map(({ value }) => ({
                          value: Number(value ?? 0),
                        }))}
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="gmv"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorGmv)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders by Order-Created Day</CardTitle>
          <CardDescription>
            Daily paid-order volume across all recorded currencies by
            order-created date
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : (
            <div className="h-[250px]">
              <ResponsiveContainer
                width="100%"
                height="100%"
                debounce={100}
                minWidth={0}
                minHeight={0}
              >
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="currentColor"
                    className="text-muted/20"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="currentColor"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="currentColor"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={(props) => (
                      <OrdersTooltip
                        active={props.active}
                        label={props.label?.toString()}
                        payload={props.payload?.map(({ value }) => ({
                          value: Number(value ?? 0),
                        }))}
                      />
                    )}
                  />
                  <Bar dataKey="orders" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
