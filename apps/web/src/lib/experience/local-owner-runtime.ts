import { randomUUID } from 'node:crypto';
import { parseExperienceManifest } from '@/schemas/experience-manifest';
import { requireExperienceOwner } from './authorization';
import type { ExperienceOwnerRuntime } from './owner-runtime';
import type { PrerenderPreviewOptions } from './prerender-preview';
import { createPreviewLaunch } from './preview-launch';
import type { PreviewVault } from './preview-service';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from './production-origins';
/** Local compatibility entry; never silently upgrades to production. */
export function createLocalExperienceRuntime(
  vault: PreviewVault,
  canonicalBase: string,
  prerender?: PrerenderPreviewOptions
): ExperienceOwnerRuntime {
  return createPreviewRuntime(
    vault,
    canonicalBase,
    prerender,
    'local-synthetic'
  );
}
export function createProductionExperienceRuntime(
  vault: PreviewVault,
  canonicalBase: string,
  prerender: PrerenderPreviewOptions & {
    executionOrigin: string;
    execute: NonNullable<PrerenderPreviewOptions['execute']>;
  }
): ExperienceOwnerRuntime {
  productionOrigin(new URL(canonicalBase).origin);
  productionDeliveryOrigins({
    executionOrigin: prerender.executionOrigin,
    hostOrigins: [
      new URL(canonicalBase).origin,
      ...(prerender.previewOrigin ? [prerender.previewOrigin] : []),
    ],
  });
  if (vault.origin !== prerender.executionOrigin)
    throw Error('INVALID_VAULT_ORIGIN');
  if (!prerender.execute || !prerender.bootstrap)
    throw Error('INCOMPLETE_PRODUCTION_PREVIEW');
  return createPreviewRuntime(vault, canonicalBase, prerender, 'production');
}
function createPreviewRuntime(
  vault: PreviewVault,
  canonicalBase: string,
  prerender: PrerenderPreviewOptions | undefined,
  profile: 'local-synthetic' | 'production'
): ExperienceOwnerRuntime {
  const base = new URL(canonicalBase);
  if (base.username || base.password || base.search || base.hash)
    throw Error('Invalid preview origin');
  if (
    profile === 'local-synthetic' &&
    (base.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(base.hostname))
  )
    throw Error('Local preview origin required');
  return {
    async createPreviewLaunch(ctx, input) {
      if (
        ctx.requestOrigin &&
        ctx.requestOrigin !== base.origin &&
        !(
          profile === 'production' &&
          ctx.requestOrigin === prerender?.previewOrigin
        )
      )
        throw Error('Invalid preview host');
      const owner = await requireExperienceOwner(ctx);
      const launch = await createPreviewLaunch(
        owner,
        input,
        vault,
        base.origin,
        prerender
      );
      try {
        const b = await owner.supabase
          .from('experience_builds')
          .select('job_id')
          .eq('merchant_id', owner.merchantId)
          .eq('id', input.buildId)
          .maybeSingle();
        if (b.error || !b.data) throw Error('NOT_FOUND');
        const j = await owner.supabase
          .from('experience_jobs')
          .select('artifact_id')
          .eq('merchant_id', owner.merchantId)
          .eq('id', b.data.job_id)
          .maybeSingle();
        if (j.error || !j.data) throw Error('NOT_FOUND');
        const a = await owner.supabase
          .from('experience_artifacts')
          .select('manifest')
          .eq('merchant_id', owner.merchantId)
          .eq('id', j.data.artifact_id)
          .maybeSingle();
        if (a.error || !a.data) throw Error('NOT_FOUND');
        const manifest = parseExperienceManifest(a.data.manifest);
        const routeId = input.routeId ?? manifest.routes[0]?.path;
        const route = manifest.routes.find(
          (r) => r.path === routeId || r.view === routeId
        );
        if (!route) throw Error('NOT_FOUND');
        await requireExperienceOwner(owner);
        return {
          ...launch,
          instanceId: randomUUID(),
          nonce: randomUUID(),
          routes: manifest.routes,
          canonicalBase,
          merchantId: owner.merchantId,
          bootstrap:
            'bootstrap' in launch
              ? launch.bootstrap
              : {
                  assets: Object.fromEntries(
                    launch.resources
                      .filter((f) => f.path.startsWith('assets/'))
                      .map((f) => [f.path.slice(7), f.url])
                  ),
                  route: {
                    epoch: 1,
                    routeId: route.view,
                    canonicalPath: route.path.replace(
                      /\[[^\]]+\]/g,
                      'synthetic'
                    ),
                    params: {},
                    publicDataRevision: 'synthetic-1',
                  },
                  capabilities: manifest.capabilities,
                  catalog: {
                    revision: 'synthetic-1',
                    products: [
                      {
                        id: 'synthetic-device',
                        slug: 'device',
                        name: 'Synthetic QA Device',
                        price: 10,
                        currency: 'USD',
                        image: null,
                        variants: [
                          { id: 'silver', label: 'Silver', available: true },
                        ],
                      },
                    ],
                  },
                },
        };
      } catch (error) {
        vault.revoke(launch.bindingId);
        throw error;
      }
    },
  };
}
