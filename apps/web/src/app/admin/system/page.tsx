'use client';

import { useToast } from '@/hooks/use-toast';
import { AdminDataErrorState } from '../admin-data-error-state';
import { SystemHealthActions } from './system-health-actions';
import { SystemHealthChecks } from './system-health-checks';
import { SystemHealthHeader } from './system-health-header';
import { SystemHealthIndexes } from './system-health-indexes';
import { SystemHealthMissingIndexes } from './system-health-missing-indexes';
import { SystemHealthSummary } from './system-health-summary';
import { useSystemHealth } from './use-system-health';

export default function SystemHealthPage() {
  const { toast } = useToast();
  const {
    health,
    loadError,
    loading,
    reloadingAnalytics,
    refreshHealth,
    reloadAnalytics,
  } = useSystemHealth(toast);

  const header = (
    <SystemHealthHeader
      loading={loading}
      reloadingAnalytics={reloadingAnalytics}
      onRefresh={refreshHealth}
      onReloadAnalytics={reloadAnalytics}
    />
  );

  if (!loading && !health) {
    return (
      <div className="space-y-6">
        {header}
        <AdminDataErrorState
          message={
            loadError ??
            'Database health could not be verified. No check data is available.'
          }
          onRetry={refreshHealth}
          retrying={loading}
          title="System health unavailable"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {loadError ? (
        <AdminDataErrorState
          message={loadError}
          onRetry={refreshHealth}
          retrying={loading}
          title="System health refresh failed"
        />
      ) : null}

      <SystemHealthSummary health={health} loading={loading} />
      <SystemHealthChecks checks={health?.health ?? []} loading={loading} />
      <SystemHealthIndexes
        indexRecommendations={health?.indexRecommendations ?? []}
        loading={loading}
      />
      <SystemHealthMissingIndexes indexes={health?.missingIndexes ?? []} />
      <SystemHealthActions
        loading={loading}
        reloadingAnalytics={reloadingAnalytics}
        onRefresh={refreshHealth}
        onReloadAnalytics={reloadAnalytics}
      />
    </div>
  );
}
