import { Activity, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type SystemHealthActionsProps = {
  loading: boolean;
  reloadingAnalytics: boolean;
  onRefresh: () => void;
  onReloadAnalytics: () => void;
};

export function SystemHealthActions({
  loading,
  reloadingAnalytics,
  onRefresh,
  onReloadAnalytics,
}: SystemHealthActionsProps) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common maintenance operations</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <Button
            variant="outline"
            className="h-auto flex-col gap-2 py-4"
            onClick={onReloadAnalytics}
            disabled={reloadingAnalytics}
          >
            <Zap className="size-6" aria-hidden="true" />
            <span>Reload Analytics</span>
            <span className="text-xs text-muted-foreground">
              Invalidate and reload the live analytics cache
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col gap-2 py-4"
            onClick={onRefresh}
            disabled={loading}
          >
            <Activity className="size-6" aria-hidden="true" />
            <span>Run Health Check</span>
            <span className="text-xs text-muted-foreground">
              Check database status
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
