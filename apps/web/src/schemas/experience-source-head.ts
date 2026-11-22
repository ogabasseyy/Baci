import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { z } from 'zod';
import { experienceDigest, experienceSourcePath } from './experience-upload';

export const experienceSourceHeadRow = z.strictObject({
  artifact_id: z.uuid(),
  version: z.number().int().positive(),
  artifact: z.strictObject({
    source_digest: experienceDigest,
    entry: experienceSourcePath,
    files: z
      .array(z.strictObject({ path: experienceSourcePath }))
      .min(1)
      .max(EXPERIENCE_LIMITS.files),
  }),
});
