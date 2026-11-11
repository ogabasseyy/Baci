import type { SemanticNode } from '@/lib/experience/semantic-data';
import { snapshotKeyDigest } from './snapshot-key';
export interface ExperienceSnapshotKey {
  build: string;
  assets: string;
  catalog: string | null;
  path: string;
  viewport?: string;
  locale?: string;
  browser?: string;
  state?: string;
  extractor?: 'semantic-v1';
}
export interface ExperienceSnapshot {
  key: ExperienceSnapshotKey;
  consumesCatalog: boolean;
  nodes: SemanticNode[];
}
/** Catalog bootstrap/binding/observed reads all force consumesCatalog=true. */
export function loadFreshSnapshot(
  snapshot: ExperienceSnapshot | null,
  current: ExperienceSnapshotKey,
  refresh: () => void
): Promise<ExperienceSnapshot | null> {
  const fresh =
    snapshot &&
    (!snapshot.consumesCatalog || current.catalog !== null) &&
    snapshotKeyDigest(snapshot.key) === snapshotKeyDigest(current);
  if (!fresh) {
    refresh();
    return Promise.resolve(null);
  }
  return Promise.resolve(snapshot);
}
