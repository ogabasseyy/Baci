import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { AdminSystemHealth } from '@/schemas/admin-system-health';

type SystemHealthSummaryProps = {
  health: AdminSystemHealth | null;
  loading: boolean;
};

type OverallHealthStatus = 'critical' | 'healthy' | 'warning';

function getHealthScore(health: AdminSystemHealth | null) {
  const checks = health?.health ?? [];
  const passingChecks = checks.filter(
    (check) => check.status === 'healthy'
  ).length;
  const totalChecks = checks.length;
  const score =
    totalChecks > 0 ? Math.round((passingChecks / totalChecks) * 100) : 0;
  const status: OverallHealthStatus =
    totalChecks === 0
      ? 'warning'
      : checks.some((check) => check.status === 'critical')
        ? 'critical'
        : checks.some((check) => check.status === 'warning')
          ? 'warning'
          : 'healthy';

  return { passingChecks, score, status, totalChecks };
}

function HealthScoreIcon({ status }: { status: OverallHealthStatus }) {
  if (status === 'healthy')
    return (
      <CheckCircle
        aria-label="Healthy overall health"
        className="size-8 text-emerald-500"
      />
    );
  if (status === 'warning')
    return (
      <AlertTriangle
        aria-label="Warning overall health"
        className="size-8 text-amber-500"
      />
    );
  return (
    <XCircle
      aria-label="Critical overall health"
      className="size-8 text-red-500"
    />
  );
}

export function SystemHealthSummary({
  health,
  loading,
}: SystemHealthSummaryProps) {
  const { passingChecks, score, status, totalChecks } = getHealthScore(health);
  const checkedAt = health?.checkedAt ? new Date(health.checkedAt) : null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Overall Health Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-stat">{score}%</span>
                <HealthScoreIcon status={status} />
              </div>
              <Progress value={score} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {passingChecks} of {totalChecks} checks passing
              </p>
              <p
                className={`text-xs font-medium capitalize ${
                  status === 'critical'
                    ? 'text-red-600'
                    : status === 'warning'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                }`}
              >
                {status} overall health
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Database</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <Database className="size-12 text-primary" aria-hidden="true" />
              <div>
                <p className="text-section-title">Supabase</p>
                <p className="text-sm text-muted-foreground">
                  PostgreSQL Database
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Last Checked</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <Clock
                className="size-12 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <p className="text-lg font-medium">
                  {checkedAt ? checkedAt.toLocaleTimeString() : 'Unknown'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {checkedAt ? checkedAt.toLocaleDateString() : ''}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
