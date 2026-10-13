import { z } from 'zod';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewCandidateConfigSchema } from './builder-preview-candidate-config';

const MAX_MERCHANT_IDENTIFIER_LENGTH = 128;
const MAX_BASE_PATH_LENGTH = 240;
const MAX_STOREFRONT_ORIGIN_LENGTH = 2_048;
const MAX_REVISION = 2_147_483_647;
const MAX_ERROR_CODE_LENGTH = 64;
const basePathPattern = /^\/(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)?$/;
const errorCodePattern = /^[a-z][a-z0-9_]*$/;

function isStorefrontOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

const merchantSchema = z.strictObject({
  basePath: z
    .string()
    .trim()
    .min(1)
    .max(MAX_BASE_PATH_LENGTH)
    .regex(basePathPattern)
    .optional(),
  id: z.string().trim().min(1).max(MAX_MERCHANT_IDENTIFIER_LENGTH),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MERCHANT_IDENTIFIER_LENGTH)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  storefrontOrigin: z
    .string()
    .trim()
    .min(1)
    .max(MAX_STOREFRONT_ORIGIN_LENGTH)
    .refine(isStorefrontOrigin, 'Expected an https storefront origin')
    .optional(),
});

export const builderPreviewMessageSchema = z.strictObject({
  candidateConfig: builderPreviewCandidateConfigSchema,
  capabilityHash: z.literal(builderDesignCapabilities.capabilityHash),
  capabilityVersion: z.literal(builderDesignCapabilities.capabilityVersion),
  merchant: merchantSchema,
  revision: z.number().int().min(0).max(MAX_REVISION),
  type: z.literal('baci.builder-preview.render'),
  version: z.literal(1),
});

const readyResponseSchema = z.strictObject({
  capabilityHash: z.literal(builderDesignCapabilities.capabilityHash),
  capabilityVersion: z.literal(builderDesignCapabilities.capabilityVersion),
  type: z.literal('baci.builder-preview.ready'),
  version: z.literal(1),
});

const renderedResponseSchema = z.strictObject({
  revision: z.number().int().min(0).max(MAX_REVISION),
  type: z.literal('baci.builder-preview.rendered'),
  version: z.literal(1),
});

const errorResponseSchema = z.strictObject({
  code: z.string().min(1).max(MAX_ERROR_CODE_LENGTH).regex(errorCodePattern),
  revision: z.number().int().min(0).max(MAX_REVISION).optional(),
  type: z.literal('baci.builder-preview.error'),
  version: z.literal(1),
});

export const builderPreviewResponseSchema = z.discriminatedUnion('type', [
  readyResponseSchema,
  renderedResponseSchema,
  errorResponseSchema,
]);

export type BuilderPreviewMessage = z.infer<typeof builderPreviewMessageSchema>;
export type BuilderPreviewResponse = z.infer<
  typeof builderPreviewResponseSchema
>;
