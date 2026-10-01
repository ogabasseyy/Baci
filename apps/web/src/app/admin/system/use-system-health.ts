import { useEffect, useState } from 'react';
import type { AdminSystemHealth } from '@/schemas/admin-system-health';
import { loadSystemHealth, reloadLiveAnalytics } from './system-health-data';

type Toast = (options: {
  title: string;
  description: string;
  variant?: 'destructive';
}) => void;

const UNKNOWN_HEALTH_MESSAGE =
  'Database health could not be verified. No successful status is being inferred from missing checks.';

export function useSystemHealth(toast: Toast) {
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadingAnalytics, setReloadingAnalytics] = useState(false);

  const applyHealthResult = (
    result: Awaited<ReturnType<typeof loadSystemHealth>>
  ) => {
    if (result.status === 'aborted') return;

    if (result.status === 'error') {
      console.error('Failed to fetch system health:', result.error);
      setLoadError(UNKNOWN_HEALTH_MESSAGE);
      toast({
        title: 'Error',
        description: 'Failed to load system health data.',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    setHealth(result.data);
    setLoadError(null);
    setLoading(false);
  };

  const refreshHealth = () => {
    const controller = new AbortController();
    setLoadError(null);
    setLoading(true);
    loadSystemHealth(controller.signal).then((result) => {
      if (!controller.signal.aborted) applyHealthResult(result);
    });
  };

  const reloadAnalytics = () => {
    setReloadingAnalytics(true);
    reloadLiveAnalytics()
      .then((result) => {
        if (result.status === 'ok') {
          toast({
            title: 'Success',
            description: 'Live analytics cache has been reloaded.',
          });
          return;
        }

        console.error('Failed to reload analytics:', result.error);
        toast({
          title: 'Error',
          description: 'Failed to reload live analytics.',
          variant: 'destructive',
        });
      })
      .finally(() => setReloadingAnalytics(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: The initial request is intentionally started once per mounted page.
  useEffect(() => {
    const controller = new AbortController();
    loadSystemHealth(controller.signal).then((result) => {
      if (!controller.signal.aborted) applyHealthResult(result);
    });
    return () => controller.abort();
  }, [toast]);

  return {
    health,
    loadError,
    loading,
    reloadingAnalytics,
    refreshHealth,
    reloadAnalytics,
  };
}
