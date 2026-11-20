import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveCanonicalBase,
  validateCanonicalRootDomain,
} from '@/lib/experience/canonical-domain';
import { createPublicOutputReader } from '@/lib/experience/public-output-reader';
import { loadLifecycleApproval } from '@/lib/experience/publication-service';
import { bindPublicHead } from './public-head-binding';

/** Normal owner/RLS reads and anonymous public projections; no service client. */
export function createPublicHeadResolver(
  owner: SupabaseClient,
  publicClient: SupabaseClient,
  rootDomain: string
) {
  validateCanonicalRootDomain(rootDomain);
  const publicOutput = createPublicOutputReader(publicClient);
  return (approvalId: string) =>
    bindPublicHead(approvalId, {
      loadReceipt: (id) => loadLifecycleApproval(owner, id),
      async loadMerchant(id) {
        const result = await owner
          .from('merchants')
          .select('slug')
          .eq('id', id)
          .maybeSingle();
        if (result.error || !result.data)
          throw Error('PUBLIC_BINDING_UNAVAILABLE');
        return result.data;
      },
      async loadBuildDigest(merchantId, buildId) {
        const result = await owner
          .from('experience_builds')
          .select('build_digest')
          .eq('merchant_id', merchantId)
          .eq('id', buildId)
          .maybeSingle();
        if (result.error || !result.data)
          throw Error('PUBLIC_BINDING_UNAVAILABLE');
        return result.data.build_digest;
      },
      canonicalBase: (slug) =>
        resolveCanonicalBase(publicClient, slug, rootDomain),
      manifest: publicOutput.manifest,
      read: publicOutput.read,
    });
}
