import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnalyticsPeriod } from './analytics-types';

type AnalyticsHeaderProps = {
  loading: boolean;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onRefresh: () => void;
  period: AnalyticsPeriod;
};

export function AnalyticsHeader({
  loading,
  onPeriodChange,
  onRefresh,
  period,
}: AnalyticsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-page-title">Analytics</h1>
        <p className="text-muted-foreground">
          Order metrics use the order-created date and the payment status
          currently recorded.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={period}
          disabled={loading}
          onValueChange={(value) => onPeriodChange(value as AnalyticsPeriod)}
        >
          <SelectTrigger className="w-[130px]" aria-label="Analytics period">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="90d">Last 90 Days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            className={`size-4 mr-2 ${loading ? 'motion-safe:animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
    </div>
  );
}
