import { Activity, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdminSystemHealth } from '@/schemas/admin-system-health';

type SystemHealthChecksProps = {
  checks: AdminSystemHealth['health'];
  loading: boolean;
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'healthy')
    return (
      <CheckCircle className="size-4 text-emerald-500" aria-hidden="true" />
    );
  if (status === 'warning')
    return (
      <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
    );
  if (status === 'critical')
    return <XCircle className="size-4 text-red-500" aria-hidden="true" />;
  return (
    <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'healthy') {
    return (
      <Badge
        className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600"
        variant="outline"
      >
        Healthy
      </Badge>
    );
  }
  if (status === 'warning') {
    return (
      <Badge
        className="border-amber-500/20 bg-amber-500/10 text-amber-600"
        variant="outline"
      >
        Warning
      </Badge>
    );
  }
  if (status === 'critical') {
    return (
      <Badge
        className="border-red-500/20 bg-red-500/10 text-red-600"
        variant="outline"
      >
        Critical
      </Badge>
    );
  }
  return <Badge variant="outline">Unknown</Badge>;
}

function HealthCheckSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="Loading health checks"
      aria-busy="true"
    >
      {['one', 'two', 'three', 'four', 'five'].map((key) => (
        <div
          key={key}
          className="flex items-center gap-4 rounded-lg border p-4"
        >
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export function SystemHealthChecks({
  checks,
  loading,
}: SystemHealthChecksProps) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Health Checks</CardTitle>
        <CardDescription>
          Status of various database and system checks
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <HealthCheckSkeleton />
        ) : checks.length > 0 ? (
          <div className="space-y-3">
            {checks.map((check) => (
              <div
                key={check.check_name}
                className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <StatusIcon status={check.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{check.check_name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {check.message}
                  </p>
                </div>
                <StatusBadge status={check.status} />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <Activity
              className="mx-auto mb-4 size-12 opacity-50"
              aria-hidden="true"
            />
            <p className="font-medium">No health check data available</p>
            <p className="text-sm">
              Health check functions may not be set up in the database.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
