import { RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SystemHealthHeaderProps = {
  loading: boolean;
  reloadingAnalytics: boolean;
  onRefresh: () => void;
  onReloadAnalytics: () => void;
};

export function SystemHealthHeader({
  loading,
  reloadingAnalytics,
  onRefresh,
  onReloadAnalytics,
}: SystemHealthHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-page-title">System Health</h1>
        <p className="text-muted-foreground">
          Monitor database performance and system status.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onRefresh} disabled={loading}>
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh Status
        </Button>
        <Button onClick={onReloadAnalytics} disabled={reloadingAnalytics}>
          <Zap
            className={`mr-2 size-4 ${reloadingAnalytics ? 'animate-pulse' : ''}`}
            aria-hidden="true"
          />
          Reload Analytics
        </Button>
      </div>
    </div>
  );
}
