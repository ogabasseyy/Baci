import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import {
  type AnalyticsPeriod,
  adminOverviewUtils,
} from './admin-overview-utils';

interface AdminOverviewTopMerchantsProps {
  analytics: PlatformAnalytics | null;
  loading: boolean;
  period: AnalyticsPeriod;
}

const SKELETON_IDS = [
  'top-merchant-skeleton-1',
  'top-merchant-skeleton-2',
  'top-merchant-skeleton-3',
  'top-merchant-skeleton-4',
  'top-merchant-skeleton-5',
];

export function AdminOverviewTopMerchants({
  analytics,
  loading,
  period,
}: AdminOverviewTopMerchantsProps) {
  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Top Performing Merchants</CardTitle>
          <CardDescription>
            By NGN paid GMV in the {adminOverviewUtils.getPeriodLabel(period)}
          </CardDescription>
        </div>
        <Link href="/admin/merchants">
          <Button size="sm" variant="outline">
            View All
            <ArrowRight className="size-4 ml-2" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {SKELETON_IDS.map((skeletonId) => (
              <div key={skeletonId} className="flex items-center gap-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        ) : analytics?.topMerchants.length ? (
          <div className="space-y-4">
            {analytics.topMerchants.slice(0, 5).map((merchant, index) => (
              <div
                key={merchant.id}
                className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{merchant.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {merchant.orders} orders
                  </p>
                </div>
                <Badge className="text-sm font-semibold" variant="secondary">
                  {adminOverviewUtils.formatCurrency(merchant.gmv)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No merchant data available yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
