import { experienceSnapshotKeySchema } from '@/schemas/experience-snapshot';
import { experienceCatalogRevision } from './catalog-revision';
import { normalizeExperiencePath } from './route-ownership';
import type { ExperienceSnapshotKey } from './snapshot-freshness';
export function snapshotKeyDigest(input: ExperienceSnapshotKey) {
  const key = experienceSnapshotKeySchema.parse(input);
  normalizeExperiencePath(key.path);
  return experienceCatalogRevision('snapshot-v1', key);
}
