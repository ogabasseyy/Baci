import { EXPERIENCE_LIMITS } from '@baci/shared/experience';
import { z } from 'zod';
import { experienceManifestSchema } from './experience-manifest';
import { experienceApplyInput } from './experience-publication';
import { experienceSourceCandidateInput } from './experience-source-candidate';
import {
  experienceDigest,
  experienceSourcePath,
  uploadDescriptorSchema,
} from './experience-upload';

const store = { storefrontId: z.uuid() };
const version = z.number().int().nonnegative();
const lifecycle = {
  ...store,
  buildId: z.uuid(),
  expectedDraftVersion: version,
  expectedPublishedVersion: version,
  idempotencyKey: z.uuid(),
};
export const experienceToolInputs = {
  get_experience_capabilities: z.strictObject(store),
  read_experience: z.discriminatedUnion('operation', [
    z.strictObject({
      ...store,
      operation: z.literal('read'),
      artifactId: z.uuid(),
      path: experienceSourcePath,
      byteOffset: version,
      maxBytes: z.number().int().min(1).max(EXPERIENCE_LIMITS.chunkBytes),
    }),
    z.strictObject({
      ...store,
      operation: z.literal('patch'),
      baseDigest: experienceDigest,
      expectedVersion: version,
      files: z
        .array(
          z.strictObject({
            path: experienceSourcePath,
            content: z.string().max(EXPERIENCE_LIMITS.fileBytes),
          })
        )
        .min(1)
        .max(EXPERIENCE_LIMITS.files),
      idempotencyKey: z.uuid(),
    }),
    experienceSourceCandidateInput.extend({
      ...store,
      operation: z.literal('adopt-upload'),
    }),
  ]),
  begin_experience_upload: z.strictObject({
    ...store,
    manifest: experienceManifestSchema,
    files: uploadDescriptorSchema,
  }),
  write_experience_chunk: z.strictObject({
    ...store,
    uploadId: z.uuid(),
    path: experienceSourcePath,
    offset: version,
    bytesBase64: z
      .string()
      .min(4)
      .max(Math.ceil(EXPERIENCE_LIMITS.chunkBytes / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    chunkDigest: experienceDigest,
  }),
  finalize_experience_upload: z.strictObject({ ...store, uploadId: z.uuid() }),
  build_experience: z.strictObject({
    ...store,
    artifactId: z.uuid(),
    idempotencyKey: z.uuid(),
  }),
  get_experience_operation: z.strictObject({ ...store, jobId: z.uuid() }),
  read_experience_performance: z.strictObject({ ...store, buildId: z.uuid() }),
  finalize_experience_build: z.strictObject({
    ...store,
    jobId: z.uuid(),
    idempotencyKey: z.uuid(),
  }),
  preview_experience: z.strictObject({
    ...store,
    buildId: z.uuid(),
    routeId: z.string().min(1).max(240),
    idempotencyKey: z.uuid(),
  }),
  apply_experience: experienceApplyInput.extend(store),
  publish_experience: z.strictObject(lifecycle),
  rollback_experience: z.strictObject(lifecycle),
  read_experience_evidence: z.strictObject({ ...store, evidenceId: z.uuid() }),
} as const;
export type ExperienceToolName = keyof typeof experienceToolInputs;
export const experienceToolNames = Object.keys(
  experienceToolInputs
) as ExperienceToolName[];
export function isExperienceTool(name: string): name is ExperienceToolName {
  return Object.hasOwn(experienceToolInputs, name);
}
