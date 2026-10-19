import type { DashboardLayoutConfig } from '@/components/analytics/analytics-grid-layout-hydration';
import { fetchWithCsrf } from '@/lib/api-client';

export async function saveDashboardLayoutPreference(
  layout: DashboardLayoutConfig,
  merchantId?: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetchWithCsrf('/api/dashboard/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(merchantId ? { 'x-baci-merchant-id': merchantId } : {}),
    },
    body: JSON.stringify({ layout_config: layout }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error('Failed to save dashboard layout preference');
  }
}

export async function fetchDashboardLayoutPreference(
  merchantId?: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetchWithCsrf('/api/dashboard/preferences', {
    method: 'GET',
    headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch dashboard layout preference');
  }

  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null) return null;

  return 'layout_config' in data
    ? (data as { layout_config?: unknown }).layout_config
    : null;
}
