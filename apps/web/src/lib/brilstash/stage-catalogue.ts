import { randomUUID } from 'node:crypto';
import type { BrilStashProduct } from '../../schemas/brilstash-feed';
import { buildBrilStashCatalogue } from './build-catalogue';
import { prepareBrilStashSnapshot } from './catalogue-snapshot';
import { loadBrilStashSources } from './load-catalogue';

type LoadedSources = Awaited<ReturnType<typeof loadBrilStashSources>>;
type StageClient = Parameters<typeof loadBrilStashSources>[0] & {
  rpc(
    name: 'stage_brilstash_catalogue_snapshot',
    args: {
      p_installation_id: string;
      p_candidate_id: string;
      p_catalogue_revision: string;
      p_expected_active_generation_id: string | null;
      p_source_read_at: string;
      p_source_rows: LoadedSources['sourceRows'];
      p_payload: BrilStashProduct[];
      p_payload_digest: string;
    }
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function stageBrilStashSnapshot(
  client: StageClient,
  context: Parameters<typeof loadBrilStashSources>[1],
  candidateId: string = randomUUID()
): Promise<{ candidateId: string }> {
  const sources = await loadBrilStashSources(client, context);
  const catalogue = buildBrilStashCatalogue(
    context,
    sources.sources,
    sources.identities,
    sources.categoryMap
  );
  const snapshot = prepareBrilStashSnapshot(catalogue.products, sources);
  if (!snapshot.ok) {
    throw new Error(`BrilStash candidate rejected: ${snapshot.code}`);
  }

  const { data, error } = await client.rpc(
    'stage_brilstash_catalogue_snapshot',
    {
      p_installation_id: context.installationId,
      p_candidate_id: candidateId,
      p_catalogue_revision: sources.catalogueRevision,
      p_expected_active_generation_id: sources.expectedActiveGenerationId,
      p_source_read_at: sources.sourceReadAt,
      p_source_rows: sources.sourceRows,
      p_payload: snapshot.products,
      p_payload_digest: snapshot.payloadDigest,
    }
  );
  if (error || data !== candidateId) {
    throw new Error('Unable to confirm BrilStash candidate staging');
  }

  return { candidateId };
}
