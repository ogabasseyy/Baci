import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from '@/lib/experience/authorization';
import { loadOwnerPreviewBootstrap } from '@/lib/experience/owner-preview-bootstrap';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import type { createRunnerExecutor } from '../experience-runner/runner-transport';
import { createVerifierCaptureWorker } from './capture-worker';

/** Resolves a build only under the owner's RLS session and a trusted active domain. */
export function createVerifierWorkerResolver(settings: {
  pool: Pool;
  runner: Parameters<typeof createRunnerExecutor>[0];
  previewOrigin: string;
  executionOrigin: string;
  canonicalBase(slug: string, client: SupabaseClient): string | Promise<string>;
}) {
  const workers = new Map<
    string,
    Awaited<ReturnType<typeof createVerifierCaptureWorker>>
  >();
  return {
    async resolve(input: OwnerRequestContext, buildId: string) {
      const owner = await requireExperienceOwner(input);
      const merchant = await owner.supabase
        .from('merchants')
        .select('slug')
        .eq('id', owner.merchantId)
        .maybeSingle();
      const build = await owner.supabase
        .from('experience_builds')
        .select('host_origin')
        .eq('merchant_id', owner.merchantId)
        .eq('id', buildId)
        .maybeSingle();
      const slug = merchant.data?.slug;
      if (
        merchant.error ||
        build.error ||
        typeof slug !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ||
        !build.data
      )
        throw Error('APPROVAL_MISMATCH');
      const canonical = new URL(
        await settings.canonicalBase(slug, owner.supabase)
      );
      if (
        canonical.username ||
        canonical.password ||
        canonical.search ||
        canonical.hash
      )
        throw Error('INVALID_VERIFIER_CONFIG');
      productionDeliveryOrigins({
        executionOrigin: settings.executionOrigin,
        hostOrigins: [canonical.origin, settings.previewOrigin],
      });
      if (build.data.host_origin !== canonical.origin)
        throw Error('APPROVAL_MISMATCH');
      const cacheKey = JSON.stringify([owner.merchantId, canonical.origin]);
      let worker = workers.get(cacheKey);
      if (!worker) {
        worker = await createVerifierCaptureWorker({
          pool: settings.pool,
          hostOrigin: canonical.origin,
          previewOrigin: settings.previewOrigin,
          bootstrap: loadOwnerPreviewBootstrap,
          runner: settings.runner,
        });
        if (workers.size >= 32) {
          const oldest = workers.keys().next().value;
          if (oldest) workers.delete(oldest);
        }
        workers.set(cacheKey, worker);
      }
      return worker;
    },
    clear() {
      workers.clear();
    },
  };
}
