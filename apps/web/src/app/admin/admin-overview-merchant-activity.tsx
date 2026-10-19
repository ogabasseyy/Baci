import { AlertTriangle, CheckCircle, Users, XCircle } from 'lucide-react';
import Link from 'next/link';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_MERCHANT_SALES_ACTIVITY } from '@/config/admin-merchant-sales-activity';
import type { PlatformAnalytics } from '@/types/analytics';
import { adminOverviewUtils } from './admin-overview-utils';

interface AdminOverviewMerchantActivityProps {
  analytics: PlatformAnalytics | null;
  loading: boolean;
}

const ACTIVITY_CARDS = [
  {
    backgroundClassName:
      'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10',
    icon: CheckCircle,
    iconClassName: 'text-emerald-500',
    iconContainerClassName: 'bg-emerald-500/10',
    key: 'healthy',
    query: 'healthy',
  },
  {
    backgroundClassName:
      'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10',
    icon: AlertTriangle,
    iconClassName: 'text-amber-500',
    iconContainerClassName: 'bg-amber-500/10',
    key: 'at_risk',
    query: 'at_risk',
  },
  {
    backgroundClassName: 'border-red-500/20 bg-red-500/5 hover:bg-red-500/10',
    icon: XCircle,
    iconClassName: 'text-red-500',
    iconContainerClassName: 'bg-red-500/10',
    key: 'churned',
    query: 'churned',
  },
  {
    backgroundClassName:
      'border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10',
    icon: Users,
    iconClassName: 'text-indigo-500',
    iconContainerClassName: 'bg-indigo-500/10',
    key: 'new',
    query: 'new',
  },
] as const;

function HealthTooltip({
  active,
  entry,
}: {
  active?: boolean;
  entry?: { key: string; value: number };
}) {
  if (!(active && entry)) return null;

  return (
    <div className="rounded-xl border bg-background/95 backdrop-blur-xs p-3 shadow-xl">
      <p className="text-sm font-medium">
        {
          ADMIN_MERCHANT_SALES_ACTIVITY[
            entry.key as keyof typeof ADMIN_MERCHANT_SALES_ACTIVITY
          ].label
        }
      </p>
      <p className="text-lg font-bold">{entry.value} merchants</p>
    </div>
  );
}

export function AdminOverviewMerchantActivity({
  analytics,
  loading,
}: AdminOverviewMerchantActivityProps) {
  const healthData = adminOverviewUtils.getHealthData(analytics);
  const chartData = healthData.map((entry) => ({
    ...entry,
    name: ADMIN_MERCHANT_SALES_ACTIVITY[
      entry.key as keyof typeof ADMIN_MERCHANT_SALES_ACTIVITY
    ].label,
  }));

  return (
    <>
      <Card className="glass">
        <CardHeader>
          <CardTitle>Merchant Sales Activity</CardTitle>
          <CardDescription>
            Based on each store&apos;s latest paid sale since 18 Dec 2025
            (Africa/Lagos)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer
                debounce={100}
                height="100%"
                minHeight={0}
                minWidth={0}
                width="100%"
              >
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="45%"
                    data={chartData}
                    dataKey="value"
                    innerRadius={50}
                    nameKey="name"
                    outerRadius={80}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => (
                      <HealthTooltip
                        active={active}
                        entry={
                          payload?.[0]?.payload as
                            | { key: string; value: number }
                            | undefined
                        }
                      />
                    )}
                  />
                  <Legend
                    formatter={(value) => (
                      <span className="text-xs font-medium text-muted-foreground ml-1">
                        {value}
                      </span>
                    )}
                    height={36}
                    iconType="circle"
                    verticalAlign="bottom"
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              No merchant data available
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {ACTIVITY_CARDS.map((activity) => {
          const Icon = activity.icon;
          const value =
            analytics?.merchantHealth[
              activity.key === 'at_risk' ? 'atRisk' : activity.key
            ];
          const labels =
            ADMIN_MERCHANT_SALES_ACTIVITY[
              activity.key as keyof typeof ADMIN_MERCHANT_SALES_ACTIVITY
            ];

          return (
            <Link
              key={activity.key}
              href={`/admin/merchants?health=${activity.query}`}
            >
              <Card
                className={`${activity.backgroundClassName} cursor-pointer transition-colors`}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div
                    className={`p-2 rounded-full ${activity.iconContainerClassName}`}
                  >
                    <Icon className={`size-5 ${activity.iconClassName}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{value || 0}</p>
                    <p className="text-sm text-muted-foreground">
                      {labels.overviewLabel}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
