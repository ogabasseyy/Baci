import type { SupabaseClient } from '@supabase/supabase-js';
import { INTEGRATION_SECRET_FIELDS } from '@/lib/integration-secret-settings';

/**
 * Adds `<secret>_configured` booleans (and a null value) for each write-only
 * integration secret. The session cannot SELECT those columns (audit R2), so
 * presence comes from a SECURITY DEFINER function that returns booleans only.
 * Returns null when presence cannot be established so callers fail closed
 * instead of showing a wrong "not configured" state.
 */
export async function attachIntegrationSecretPresence<T extends object>(
  supabase: SupabaseClient,
  merchantId: string,
  settings: T
): Promise<T | null> {
  const { data, error } = await supabase.rpc(
    'get_merchant_integration_secret_presence',
    { p_merchant_id: merchantId }
  );
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    if (error) console.error('Integration secret presence failed:', error);
    return null;
  }
  const presence = data as Record<string, unknown>;
  const result: Record<string, unknown> = {
    ...(settings as Record<string, unknown>),
  };
  for (const key of INTEGRATION_SECRET_FIELDS) {
    result[key] = null;
    result[`${key}_configured`] = presence[key] === true;
  }
  return result as T;
}
