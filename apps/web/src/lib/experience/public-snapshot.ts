import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSemanticSnapshot } from '@/lib/experience/semantic-data';
import { experienceSnapshotKeySchema } from '@/schemas/experience-snapshot';
import type {
  ExperienceSnapshot,
  ExperienceSnapshotKey,
} from './snapshot-freshness';
import { snapshotKeyDigest } from './snapshot-key';
/** Public RPC returns only the exact current-head semantic tree, never evidence/source. */
export async function loadPublicSnapshot(
  client: SupabaseClient,
  slug: string,
  key: ExperienceSnapshotKey,
  current: () => Promise<boolean>
): Promise<ExperienceSnapshot | null> {
  if (!(await current())) return null;
  const r = await client.rpc('experience_public_snapshot', {
    p_slug: slug,
    p_build: key.build,
    p_key: snapshotKeyDigest(key),
  });
  if (r.error || !r.data || !(await current())) return null;
  try {
    const raw = r.data as Record<string, unknown>;
    if (
      Object.keys(raw).some(
        (k) => !['key', 'consumesCatalog', 'nodes'].includes(k)
      ) ||
      typeof raw.consumesCatalog !== 'boolean'
    )
      return null;
    const returned = experienceSnapshotKeySchema.parse(raw.key);
    if (
      snapshotKeyDigest(returned) !== snapshotKeyDigest(key) ||
      (raw.consumesCatalog && returned.catalog === null)
    )
      return null;
    const tree = validateSemanticSnapshot({
      revision: returned.catalog ?? 'non-catalog',
      path: returned.path,
      nodes: raw.nodes,
    });
    return {
      key: returned,
      consumesCatalog: raw.consumesCatalog,
      nodes: tree.nodes,
    };
  } catch {
    return null;
  }
}
