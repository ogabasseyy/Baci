import { AlertTriangle, Crown, Target, Users } from 'lucide-react';
import { BentoCard } from '@/components/ui/bento-card';
import { cn } from '@/lib/utils';
import type {
  AnalyticsData,
  CurrencyFormatter,
  WidgetVisibility,
} from './analytics-grid-types';

const SEGMENT_COLORS: Record<string, string> = {
  Champions: 'bg-green-500',
  Loyal: 'bg-blue-500',
  Potential: 'bg-purple-500',
  New: 'bg-cyan-500',
  'At Risk': 'bg-amber-500',
  Hibernating: 'bg-orange-500',
  Lost: 'bg-red-500',
};

interface AnalyticsSegmentWidgetsProps {
  data: AnalyticsData;
  formatCurrency: CurrencyFormatter;
  isWidgetVisible: WidgetVisibility;
}

export function AnalyticsSegmentWidgets({
  data,
  formatCurrency,
  isWidgetVisible,
}: AnalyticsSegmentWidgetsProps) {
  const atRiskAverageClv = data.segmentSummary?.at_risk_avg_clv;
  const champions = data.segmentSummary?.segments.find(
    (segment) => segment.segment === 'Champions'
  );
  return (
    <>
      {isWidgetVisible('segment-overview') && (
        <div key="segment-overview">
          <BentoCard title="Segment Overview" icon={Target} className="h-full">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Total Customers
                </span>
                <span className="text-2xl font-bold">
                  {data.segmentSummary?.total_customers || 0}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-green-500/10 p-3 text-center">
                  <Crown className="mx-auto mb-1 size-5 text-green-600" />
                  <div className="text-lg font-bold text-green-600">
                    {data.segmentSummary?.champions_count || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Champions</div>
                </div>
                <div className="rounded-lg bg-red-500/10 p-3 text-center">
                  <AlertTriangle className="mx-auto mb-1 size-5 text-red-600" />
                  <div className="text-lg font-bold text-red-600">
                    {data.segmentSummary?.at_risk_count || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">At Risk</div>
                </div>
              </div>
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('segment-distribution') && (
        <div key="segment-distribution">
          <BentoCard
            title="Segment Distribution"
            icon={Users}
            className="h-full"
          >
            <div className="space-y-3">
              {(data.segmentSummary?.segments || []).map((segment) => {
                const total = data.segmentSummary?.total_customers || 1;
                const percentage = Math.round((segment.count / total) * 100);
                return (
                  <div key={segment.segment} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{segment.segment}</span>
                      <span className="font-medium">
                        {segment.count} ({percentage}%)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full transition-all',
                          SEGMENT_COLORS[segment.segment] || 'bg-primary'
                        )}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {(data.segmentSummary?.segments || []).length === 0 && (
                <div className="py-4 text-center text-muted-foreground">
                  <Users className="mx-auto mb-2 size-8 opacity-50" />
                  <p className="text-sm">No segment data yet</p>
                </div>
              )}
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('at-risk-customers') && (
        <div key="at-risk-customers">
          <BentoCard
            title="At-Risk Customers"
            icon={AlertTriangle}
            className="h-full"
          >
            <div className="space-y-2">
              <p className="mb-3 text-sm text-muted-foreground">
                Customers who haven&apos;t purchased recently and may churn
              </p>
              <div className="flex items-center justify-between rounded-lg bg-red-500/10 p-3">
                <div>
                  <div className="text-2xl font-bold text-red-600">
                    {data.segmentSummary?.at_risk_count || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    customers at risk
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {atRiskAverageClv !== undefined
                      ? formatCurrency(atRiskAverageClv)
                      : 'N/A'}
                  </div>
                  <div className="text-xs text-muted-foreground">avg. CLV</div>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Consider re-engagement campaigns to win them back
              </p>
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('champions-list') && (
        <div key="champions-list">
          <BentoCard title="Champion Customers" icon={Crown} className="h-full">
            <div className="space-y-2">
              <p className="mb-3 text-sm text-muted-foreground">
                Your most valuable customers - frequent buyers with high spend
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-green-500/10 p-3 text-center">
                  <div className="text-lg font-bold text-green-600">
                    {data.segmentSummary?.champions_count || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Champions</div>
                </div>
                <div className="rounded-lg bg-muted/30 p-3 text-center">
                  <div className="text-lg font-bold">
                    {champions?.total_revenue
                      ? formatCurrency(champions.total_revenue)
                      : 'N/A'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Segment Revenue
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 p-3 text-center">
                  <div className="text-lg font-bold">
                    {champions?.avg_clv
                      ? formatCurrency(champions.avg_clv)
                      : 'N/A'}
                  </div>
                  <div className="text-xs text-muted-foreground">Avg CLV</div>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Reward these customers with exclusive offers and early access
              </p>
            </div>
          </BentoCard>
        </div>
      )}
    </>
  );
}
