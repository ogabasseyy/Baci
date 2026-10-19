import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlatformAnalytics } from '@/types/analytics';
import { formatAnalyticsCurrency } from './analytics-format';

type AnalyticsMerchantPerformanceProps = {
  analytics: PlatformAnalytics | null;
  loading: boolean;
};

export function AnalyticsMerchantPerformance({
  analytics,
  loading,
}: AnalyticsMerchantPerformanceProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Merchant Performance</CardTitle>
        <CardDescription>NGN paid GMV contribution by merchant</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders are static
              <div key={index} className="flex items-center gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : analytics?.topMerchants.length ? (
          <div className="space-y-4">
            {analytics.topMerchants.map((merchant, index) => (
              <div key={merchant.name} className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-32 min-w-0">
                  <Badge variant="outline" className="shrink-0">
                    #{index + 1}
                  </Badge>
                  <span className="text-sm font-medium truncate">
                    {merchant.name}
                  </span>
                </div>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        analytics.summary.totalGmv > 0
                          ? (merchant.gmv / analytics.summary.totalGmv) * 100
                          : 0,
                        100
                      )}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-medium w-20 text-right">
                  {formatAnalyticsCurrency(merchant.gmv)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No merchant data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
