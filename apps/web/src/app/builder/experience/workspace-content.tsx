import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { merchantIdParamSchema } from '@/schemas/merchant-id-param';
import { ExperienceWorkspace } from './workspace-client';
export async function ExperienceWorkspaceContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  try {
    const q = await searchParams;
    const wanted = q.merchant
      ? merchantIdParamSchema.parse(q.merchant)
      : undefined;
    const client = await createClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user)
      return (
        <main>
          <h1>Full-code experience</h1>
          <a href="/login">Sign in as the store owner</a>
        </main>
      );
    const merchant = await getMerchantForApiRequest(client, auth.data.user.id, {
      requestedMerchantId: wanted,
    });
    if (!merchant?.staffAccess.isOwner)
      return (
        <main>
          <h1>Owner workspace</h1>
          <p>
            Only the store owner can read private source or confirm changes.
          </p>
        </main>
      );
    const id = merchant.merchantId;
    const [source, builds, draft, published, revision] = await Promise.all([
      client
        .from('experience_source_heads')
        .select('artifact_id,version')
        .eq('merchant_id', id)
        .maybeSingle(),
      client
        .from('experience_builds')
        .select('id,build_digest,job_id')
        .eq('merchant_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      client
        .from('experience_draft_heads')
        .select('version')
        .eq('merchant_id', id)
        .maybeSingle(),
      client
        .from('experience_published_heads')
        .select('publication_revision')
        .eq('merchant_id', id)
        .maybeSingle(),
      client
        .from('builder_website_revisions')
        .select('token')
        .eq('merchant_id', id)
        .maybeSingle(),
    ]);
    if ([source, builds, draft, published, revision].some((r) => r.error))
      throw Error();
    const artifact = source.data?.artifact_id ?? null;
    let paths: string[] = [];
    let sourceDigest: string | null = null;
    if (artifact) {
      const [files, meta] = await Promise.all([
        client
          .from('experience_source_files')
          .select('path')
          .eq('merchant_id', id)
          .eq('artifact_id', artifact)
          .order('path', { ascending: true })
          .limit(128),
        client
          .from('experience_artifacts')
          .select('source_digest')
          .eq('merchant_id', id)
          .eq('id', artifact)
          .maybeSingle(),
      ]);
      if (files.error || meta.error || !meta.data) throw Error();
      paths = files.data?.map((f) => f.path) ?? [];
      sourceDigest = meta.data.source_digest;
    }
    const candidates = builds.data ?? [];
    const evidence = candidates.length
      ? await client
          .from('experience_evidence')
          .select('id,job_id,build_digest')
          .eq('merchant_id', id)
          .in(
            'job_id',
            candidates.map((b) => b.job_id)
          )
      : { data: [], error: null };
    if (evidence.error) throw Error();
    return (
      <ExperienceWorkspace
        merchantId={id}
        artifactId={artifact}
        sourceDigest={sourceDigest}
        sourceVersion={source.data?.version ?? 0}
        paths={paths}
        builds={candidates.map((b) => ({
          ...b,
          evidenceId: evidence.data?.find(
            (e) => e.job_id === b.job_id && e.build_digest === b.build_digest
          )?.id,
        }))}
        draftVersion={draft.data?.version ?? 0}
        publishedVersion={published.data?.publication_revision ?? 0}
        websiteRevision={revision.data?.token ?? null}
        enabled={!!getExperienceOwnerRuntime()?.approval}
      />
    );
  } catch {
    return (
      <main>
        <h1>Experience workspace unavailable</h1>
        <p>Sign in as the owner and select the current store.</p>
      </main>
    );
  }
}
