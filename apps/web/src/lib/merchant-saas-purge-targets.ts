import 'server-only';
import { createDomainLifecycleWriter } from '@/lib/domain-lifecycle-writer';

export type MerchantSaasPurgeTargetsResult =
  | { ok: true; zones: Map<string, string[]> }
  | { ok: false; errorCode: string };

/**
 * Resolves active Cloudflare-for-SaaS hostnames for a merchant grouped by
 * Cloudflare zone ID via the restricted `baci_domain_lifecycle_writer` boundary
 * (never constructing a broad `service_role` client).
 *
 * Queries persisted bindings whenever the restricted writer is configured,
 * even if `CLOUDFLARE_SAAS_ZONE_ID` is temporarily unset during rotation or
 * onboarding shutdown. Fails closed if `CLOUDFLARE_SAAS_ZONE_ID` is configured
 * without a writer, or if the writer lookup fails.
 */
export async function resolveMerchantSaasPurgeTargets(
  merchantId: string
): Promise<MerchantSaasPurgeTargetsResult> {
  const defaultSaasZoneId = process.env.CLOUDFLARE_SAAS_ZONE_ID?.trim();
  const writer = createDomainLifecycleWriter();

  if (!writer) {
    if (defaultSaasZoneId) {
      return { ok: false, errorCode: 'saas_purge_writer_unavailable' };
    }
    return { ok: true, zones: new Map() };
  }

  try {
    const rows = await writer.listActiveSaasPurgeTargets(merchantId);
    const zones = new Map<string, string[]>();
    for (const row of rows) {
      const host = row.hostname?.trim().toLowerCase();
      const zoneId = row.cloudflare_zone_id?.trim() || defaultSaasZoneId;
      if (!host) continue;
      if (!zoneId) {
        return { ok: false, errorCode: 'saas_purge_zone_missing' };
      }
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
