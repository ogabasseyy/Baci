import { fetchWithCsrf } from '@/lib/api-client';

export async function syncStock(
  integrationId: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const response = await fetchWithCsrf(
      `/api/marketplace/jumia/products/stock?integrationId=${encodeURIComponent(integrationId)}`,
      { method: 'POST' }
    );
    const data = await response.json();
    if (!response.ok) {
      const detail = data.details
        ? `${data.error || 'Stock sync failed'}\nDetails: ${data.details}`
        : data.error || 'Stock sync failed';
      return { ok: false, error: detail };
    }
    // The route reports logical failures (nothing pushed) as HTTP 200 with
    // `success: false`; surfacing those as success would toast a lie.
    if (data.success === false) {
      return { ok: false, error: data.message || 'Stock sync failed' };
    }
    return { ok: true, message: data.message || 'Stock synced' };
  } catch {
    return { ok: false, error: 'Stock sync failed — please try again' };
  }
}
