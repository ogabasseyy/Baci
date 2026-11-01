import { z } from 'zod';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewMessageSchema } from './builder-preview-message';
import { restoreNativePreviewPlaceholders } from './native-preview-placeholder-input';

const sessionNonceSchema = z.string().regex(/^[0-9a-f]{32}$/);
const revisionSchema = z.number().int().min(0).max(2_147_483_647);

export const builderNativePreviewInitSchema = z.strictObject({
  sessionNonce: sessionNonceSchema,
  previousSessionNonce: sessionNonceSchema.optional(),
  type: z.literal('baci.builder-preview.native-init'),
  version: z.literal(2),
});

export const builderNativePreviewRenderSchema =
  builderPreviewMessageSchema.extend({
    candidateConfig: z.preprocess(
      restoreNativePreviewPlaceholders,
      builderPreviewMessageSchema.shape.candidateConfig
    ),
    sessionNonce: sessionNonceSchema,
    type: z.literal('baci.builder-preview.native-render'),
    version: z.literal(2),
  });

export const builderNativePreviewResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({
    capabilityHash: z.literal(builderDesignCapabilities.capabilityHash),
    capabilityVersion: z.literal(builderDesignCapabilities.capabilityVersion),
    sessionNonce: sessionNonceSchema,
    type: z.literal('baci.builder-preview.native-ready'),
    version: z.literal(2),
  }),
  z.strictObject({
    revision: revisionSchema,
    sessionNonce: sessionNonceSchema,
    type: z.literal('baci.builder-preview.native-rendered'),
    version: z.literal(2),
  }),
  z.strictObject({
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    revision: revisionSchema.optional(),
    sessionNonce: sessionNonceSchema,
    type: z.literal('baci.builder-preview.native-error'),
    version: z.literal(2),
  }),
]);

export type BuilderNativePreviewInit = z.infer<
  typeof builderNativePreviewInitSchema
>;
export type BuilderNativePreviewRender = z.infer<
  typeof builderNativePreviewRenderSchema
>;
export type BuilderNativePreviewResponse = z.infer<
  typeof builderNativePreviewResponseSchema
>;
