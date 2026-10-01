import { fetchWithCsrf } from '@/lib/api-client';
import {
  type AdminSystemHealth,
  adminSystemHealthSchema,
} from '@/schemas/admin-system-health';

export type SystemHealthLoadResult =
  | { status: 'ok'; data: AdminSystemHealth }
  | { status: 'aborted' }
  | { status: 'error'; error: unknown };

export async function loadSystemHealth(
  signal: AbortSignal
): Promise<SystemHealthLoadResult> {
  try {
    const response = await fetch('/api/admin/db-health', { signal });
    if (!response.ok) throw new Error('Failed to fetch health data');

    const parsed = adminSystemHealthSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Invalid system health response');

    return { status: 'ok', data: parsed.data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'aborted' };
    }

    return { status: 'error', error };
  }
}

export async function reloadLiveAnalytics(): Promise<
  { status: 'ok' } | { status: 'error'; error: unknown }
> {
  try {
    const response = await fetchWithCsrf('/api/admin/analytics', {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to reload analytics');

    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error };
  }
}
