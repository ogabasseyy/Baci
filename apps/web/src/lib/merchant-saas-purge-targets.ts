import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

export type MerchantSaasPurgeTargetsResult =
  | { ok: true; zones: Map<string, string[]> }
  | { ok: false; errorCode: string };

interface SaasPurgeBindingRow {
  hostname: string | null;
  cloudflare_zone_id: string | null;
}

interface UntypedTableClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        eq(
          column: string,
          value: string
        ): {
          eq(
            column: string,
            value: string
          ): Promise<{
            data: SaasPurgeBindingRow[] | null;
            error: unknown;
          }>;
        };
      };
    };
  };
}

/**
 * Resolves active Cloudflare-for-SaaS hostnames for a merchant grouped by
 * Cloudflare zone ID. Returns an empty map when CLOUDFLARE_SAAS_ZONE_ID is
 * unset so legacy single-zone environments incur zero extra queries.
 */
export async function resolveMerchantSaasPurgeTargets(
  merchantId: string
): Promise<MerchantSaasPurgeTargetsResult> {
  const defaultSaasZoneId = process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim();
  if (!defaultSaasZoneId) {
    return { ok: true, zones: new Map() };
  }

  try {
    const supabase = createServiceClient(
      'event-pipeline'
    ) as unknown as UntypedTableClient;
    const { data, error } = await supabase
      .from('domain_provider_bindings')
      .select('hostname, cloudflare_zone_id')
      .eq('merchant_id', merchantId)
      .eq('lifecycle_state', 'active')
      .eq('dns_routing_provider', 'cloudflare_saas');

    if (error) {
      return { ok: false, errorCode: 'saas_purge_target_lookup_failed' };
    }

    const zones = new Map<string, string[]>();
    for (const row of data ?? []) {
      const host = row.hostname?.trim().toLowerCase();
      const zoneId = row.cloudflare_zone_id?.trim() || defaultSaasZoneId;
      if (!host || !zoneId) continue;
      const list = zones.get(zoneId) ?? [];
      if (!list.includes(host)) {
        list.push(host);
        zones.set(zoneId, list);
      }
    }

    return { ok: true, zones };
  } catch {
    return { ok: false, errorCode: 'saas_purge_target_lookup_failed' };
  }
}
