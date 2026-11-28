import { NextResponse } from 'next/server';
import { readCloudflareSaasConfig } from '@/lib/cloudflare-saas';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { createDomainLifecycleWriter } from '@/lib/domain-lifecycle-writer';
import {
  reconcileDeletingBinding,
  reconcileProvisioningBinding,
} from '@/lib/domain-saas-orchestrator';
import { triggerDomainEdgeConfigSync } from '@/lib/edge-config-sync';

export const maxDuration = 60;
const BATCH_LIMIT = 10;
const LEASE_SECONDS = 30;

/**
 * GET /api/cron/reconcile-domain-bindings
 * Claims due `provisioning`, `deleting`, and `deleting_reconciling` bindings
 * under the restricted `baci_domain_lifecycle_writer` role and reconciles
 * provider state without requiring any merchant browser session or retry.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cfConfig = readCloudflareSaasConfig();
  const writer = createDomainLifecycleWriter();
  if (!cfConfig || !writer) {
    return NextResponse.json({
      claimed: 0,
      reconciled: 0,
      released: 0,
      failed: 0,
      disabled: true,
    });
  }

  let claimedBindings: Awaited<ReturnType<typeof writer.claimDueBindings>>;
  try {
    claimedBindings = await writer.claimDueBindings(BATCH_LIMIT, LEASE_SECONDS);
  } catch (error) {
    console.error('[reconcile-domain-bindings] Claim failed:', error);
    return NextResponse.json(
      { error: 'Failed to claim due domain bindings' },
      { status: 500 }
    );
  }

  let reconciled = 0;
  let released = 0;
  let failed = 0;

  for (const binding of claimedBindings) {
    try {
      if (binding.lifecycle_state === 'provisioning') {
        await reconcileProvisioningBinding(binding, { cfConfig, writer });
        reconciled += 1;
      } else if (
        binding.lifecycle_state === 'deleting' ||
        binding.lifecycle_state === 'deleting_reconciling'
      ) {
        const outcome = await reconcileDeletingBinding(binding, {
          cfConfig,
          writer,
        });
        reconciled += 1;
        if (outcome.released) {
          released += 1;
        }
      }
    } catch (error) {
      console.error(
        `[reconcile-domain-bindings] Failed for ${binding.hostname}:`,
        error
      );
      failed += 1;
    }
  }

  if (released > 0) {
    await triggerDomainEdgeConfigSync().catch(() => undefined);
  }

  return NextResponse.json({
    claimed: claimedBindings.length,
    reconciled,
    released,
    failed,
  });
}
