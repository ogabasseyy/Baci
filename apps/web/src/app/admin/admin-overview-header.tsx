import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AnalyticsPeriod } from './admin-overview-utils';

interface AdminOverviewHeaderProps {
  loading: boolean;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onRefresh: () => void;
  period: AnalyticsPeriod;
  refreshing: boolean;
}

const PERIOD_BUTTONS: Array<{ label: string; value: AnalyticsPeriod }> = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
  { label: 'All', value: 'all' },
];

export function AdminOverviewHeader({
  loading,
  onPeriodChange,
  onRefresh,
  period,
  refreshing,
}: AdminOverviewHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-page-title">Platform Overview</h1>
        <p className="text-muted-foreground">
          Monitor your platform&apos;s health, growth, and merchant activity.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <fieldset
          className="flex items-center rounded-lg border bg-background p-1"
          aria-label="Analytics period"
        >
          {PERIOD_BUTTONS.map((option) => (
            <Button
              key={option.value}
              className="text-xs"
              disabled={refreshing || loading}
              onClick={() => onPeriodChange(option.value)}
              size="sm"
              variant={period === option.value ? 'default' : 'ghost'}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
        <Button
          disabled={refreshing || loading}
          onClick={onRefresh}
          size="sm"
          variant="outline"
        >
          <RefreshCw
            className={`size-4 mr-2 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
    </div>
  );
}
