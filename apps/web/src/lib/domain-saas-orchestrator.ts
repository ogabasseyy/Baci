import 'server-only';
import {
  type CloudflareSaasConfig,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostnameVerified,
  extractCloudflareVerificationRecords,
  findCloudflareCustomHostnameByName,
  getCloudflareCustomHostname,
} from '@/lib/cloudflare-saas';
import type {
  DomainBindingRow,
  DomainLifecycleWriter,
} from '@/lib/domain-lifecycle-writer';
import { vercel } from '@/lib/vercel';
import type { DomainVerificationRecord } from '@/schemas/cloudflare-saas';

export interface DomainOrchestratorDeps {
  cfConfig: CloudflareSaasConfig;
  writer: DomainLifecycleWriter;
  vercelClient?: Pick<
    typeof vercel,
    'addDomain' | 'removeDomain' | 'verifyDomain'
  >;
}

export interface ReconcileProvisioningResult {
  binding: DomainBindingRow;
  settled: boolean;
  verificationRecords: DomainVerificationRecord[];
}

export interface ReconcileDeletionResult {
  released: boolean;
  binding: DomainBindingRow;
}

function mergeVercelChallengeRecords(
  existing: DomainVerificationRecord[],
  verification?: Array<{
    type: string;
    domain: string;
    value: string;
    reason: string;
  }>
): DomainVerificationRecord[] {
  if (!verification || verification.length === 0) return existing;
  const merged = [...existing];
  for (const item of verification) {
    if (item.type === 'TXT' && item.domain && item.value) {
      const alreadyPresent = merged.some(
        (r) =>
          r.purpose === 'vercel_ownership' &&
          r.name === item.domain &&
          r.value === item.value
      );
      if (!alreadyPresent) {
        merged.push({
          name: item.domain,
          purpose: 'vercel_ownership',
          status: 'pending',
          type: 'TXT',
          value: item.value,
        });
      }
    }
  }
  return merged;
}

/**
 * Reconciles a `provisioning` binding across Cloudflare for SaaS and Vercel.
 * Never issues a second Cloudflare create when an earlier attempt is unresolved
 * (`in_flight` or `indeterminate`); always records `in_flight` before calling
 * an external provider so hard crashes are recovered by the scheduled worker.
 */
export async function reconcileProvisioningBinding(
  initialBinding: DomainBindingRow,
  deps: DomainOrchestratorDeps
): Promise<ReconcileProvisioningResult> {
  const { cfConfig, writer, vercelClient = vercel } = deps;
  const operationId = initialBinding.current_operation_id;
  if (!operationId) {
    return {
      binding: initialBinding,
      settled: false,
      verificationRecords: initialBinding.provider_verification_records,
    };
  }

  let binding = initialBinding;
  let records: DomainVerificationRecord[] =
    binding.provider_verification_records ?? [];

  // 1. Cloudflare Custom Hostname step
  if (binding.cloudflare_create_state !== 'confirmed') {
    const isResumingUnresolved =
      binding.cloudflare_create_state === 'in_flight' ||
      binding.cloudflare_create_state === 'indeterminate';

    try {
      if (!isResumingUnresolved) {
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'cloudflare',
          state: 'in_flight',
          cloudflareZoneId: cfConfig.zoneId,
        });
      }

      let remote = binding.cloudflare_hostname_id
        ? await getCloudflareCustomHostname(
            binding.cloudflare_hostname_id,
            cfConfig
          )
        : await findCloudflareCustomHostnameByName(binding.hostname, cfConfig);

      if (!remote && !isResumingUnresolved) {
        remote = await createCloudflareCustomHostname(
          binding.hostname,
          cfConfig
        );
      }

      if (remote) {
        records = extractCloudflareVerificationRecords(
          binding.hostname,
          remote
        );
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'cloudflare',
          state: 'confirmed',
          cloudflareZoneId: cfConfig.zoneId,
          cloudflareHostnameId: remote.id,
          verificationRecords: records,
        });
      } else {
        // Resuming an unresolved attempt that has not appeared yet:
        // do NOT issue a second create; keep indeterminate for next sweep.
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'cloudflare',
          state: 'indeterminate',
          nextReconcileSeconds: 120,
        });
      }
    } catch {
      binding = await writer.recordProviderResult({
        domainId: binding.domain_id,
        operationId,
        provider: 'cloudflare',
        state: 'indeterminate',
        nextReconcileSeconds: 120,
      });
    }
  }

  // 2. Vercel Project Domain step
  if (binding.vercel_create_state !== 'confirmed') {
    const isResumingUnresolved =
      binding.vercel_create_state === 'in_flight' ||
      binding.vercel_create_state === 'indeterminate';

    try {
      if (!isResumingUnresolved) {
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'vercel',
          state: 'in_flight',
        });
        const added = await vercelClient.addDomain(binding.hostname);
        records = mergeVercelChallengeRecords(records, added.verification);
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'vercel',
          state: 'confirmed',
          verificationRecords: records,
        });
      } else {
        const verified = await vercelClient.verifyDomain(binding.hostname);
        records = mergeVercelChallengeRecords(records, verified.verification);
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'vercel',
          state: 'confirmed',
          verificationRecords: records,
        });
      }
    } catch {
      binding = await writer.recordProviderResult({
        domainId: binding.domain_id,
        operationId,
        provider: 'vercel',
        state: 'indeterminate',
        nextReconcileSeconds: 120,
      });
    }
  }

  return {
    binding,
    settled: binding.lifecycle_state === 'pending_verification',
    verificationRecords:
      binding.provider_verification_records.length > 0
        ? binding.provider_verification_records
        : records,
  };
}

/**
 * Reconciles a `deleting` or `deleting_reconciling` binding across Cloudflare
 * and Vercel. Only releases the hostname when both providers are confirmed
 * terminal; never releases early while an unresolved create is still pending.
 */
export async function reconcileDeletingBinding(
  initialBinding: DomainBindingRow,
  deps: DomainOrchestratorDeps
): Promise<ReconcileDeletionResult> {
  const { cfConfig, writer, vercelClient = vercel } = deps;
  const operationId = initialBinding.current_operation_id;
  if (!operationId) {
    return { released: false, binding: initialBinding };
  }

  let binding = initialBinding;

  // 1. Cloudflare cleanup
  if (
    binding.cloudflare_create_state !== 'deleted' &&
    binding.cloudflare_create_state !== 'none'
  ) {
    const wasUnresolved =
      binding.cloudflare_create_state === 'in_flight' ||
      binding.cloudflare_create_state === 'indeterminate';

    try {
      const targetConfig: CloudflareSaasConfig = {
        ...cfConfig,
        zoneId: binding.cloudflare_zone_id ?? cfConfig.zoneId,
      };
      const result = await deleteCloudflareCustomHostnameVerified(
        binding.hostname,
        binding.cloudflare_hostname_id,
        targetConfig
      );

      // A 404 on an already-known Cloudflare hostname ID is terminal (the object
      // was deleted on an earlier attempt whose response was lost). Only keep
      // `indeterminate` when no provider ID was ever recorded for an unresolved create.
      const isTerminalMissing =
        !wasUnresolved ||
        result.resolvedId !== null ||
        binding.cloudflare_hostname_id !== null;

      if (isTerminalMissing) {
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'cloudflare',
          state: 'deleted',
        });
      } else {
        // Unresolved create with no known ID not visible yet: schedule another check.
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'cloudflare',
          state: 'indeterminate',
          nextReconcileSeconds: 120,
        });
      }
    } catch {
      binding = await writer.recordProviderResult({
        domainId: binding.domain_id,
        operationId,
        provider: 'cloudflare',
        state: 'indeterminate',
        nextReconcileSeconds: 120,
      });
    }
  }

  // 2. Vercel cleanup
  if (
    binding.vercel_create_state !== 'deleted' &&
    binding.vercel_create_state !== 'none'
  ) {
    try {
      await vercelClient.removeDomain(binding.hostname);
      binding = await writer.recordProviderResult({
        domainId: binding.domain_id,
        operationId,
        provider: 'vercel',
        state: 'deleted',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const isNotFound =
        message.includes('not found') || message.includes('404');
      if (isNotFound) {
        // Not-found on Vercel DELETE is terminal for confirmed, in_flight, and
        // indeterminate attempts (including lost-response retries).
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'vercel',
          state: 'deleted',
        });
      } else {
        binding = await writer.recordProviderResult({
          domainId: binding.domain_id,
          operationId,
          provider: 'vercel',
          state: 'indeterminate',
          nextReconcileSeconds: 120,
        });
      }
    }
  }

  const released = await writer.finalizeDomainDeletion(
    binding.domain_id,
    operationId,
    false
  );

  return { released, binding };
}

export async function probeStorefrontRouting(
  hostname: string,
  expectedMerchantSlug: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetchImpl(`https://${hostname}/`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: response.status,
        error: `Routing probe returned HTTP ${response.status}`,
      };
    }

    const normalizedSlug = expectedMerchantSlug.trim().toLowerCase();
    const headerSlug = response.headers
      .get('x-baci-merchant-slug')
      ?.trim()
      .toLowerCase();
    if (headerSlug) {
      if (headerSlug === normalizedSlug) {
        return { ok: true, status: response.status };
      }
      return {
        ok: false,
        status: response.status,
        error: 'Routing probe reached a different storefront tenant',
      };
    }

    const bodyText = await response.text().catch(() => '');
    const metaMatch = bodyText.match(
      /<meta[^>]+name=["']baci-merchant-slug["'][^>]+content=["']([^"']+)["']/i
    );
    const dataAttrMatch = bodyText.match(
      /data-baci-merchant-slug=["']([^"']+)["']/i
    );
    const markerSlug = (metaMatch?.[1] ?? dataAttrMatch?.[1] ?? '')
      .trim()
      .toLowerCase();

    if (markerSlug && markerSlug === normalizedSlug) {
      return { ok: true, status: response.status };
    }

    return {
      ok: false,
      status: response.status,
      error:
        'Routing probe did not confirm expected storefront tenant response',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Routing probe failed',
    };
  }
}
