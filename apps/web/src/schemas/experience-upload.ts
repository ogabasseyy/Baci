import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { z } from 'zod';
export const experienceSourcePath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9_./-]+$/)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
  );
export const experienceDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadDescriptorSchema = z
  .strictObject({
    files: z
      .array(
        z.strictObject({
          path: experienceSourcePath,
          bytes: z.number().int().min(0).max(EXPERIENCE_LIMITS.fileBytes),
          digest: experienceDigest,
        })
      )
      .min(1)
      .max(EXPERIENCE_LIMITS.files),
  })
  .superRefine((v, c) => {
    if (
      v.files.reduce((n, f) => n + f.bytes, 0) >
        EXPERIENCE_LIMITS.sourceBytes ||
      new Set(v.files.map((f) => f.path.toLowerCase())).size !== v.files.length
    )
      c.addIssue({ code: 'custom', message: 'Invalid source budget or paths' });
  });
export const experienceChunkSchema = z.strictObject({
  uploadId: z.uuid(),
  path: experienceSourcePath,
  offset: z.number().int().min(0).max(EXPERIENCE_LIMITS.sourceBytes),
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.length > 0 && b.length <= EXPERIENCE_LIMITS.chunkBytes),
  chunkDigest: experienceDigest,
});
