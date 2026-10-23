import { z } from 'zod';
import { getAllBusinessTypeIds } from '@/config/business-types';
import { builderError } from '@/lib/builder-connector/errors';
import { isReservedMerchantSlug } from '@/lib/validation';
import {
  BUILDER_REQUEST_BYTES,
  builderIdSchema as id,
  builderRevisionSchema as revision,
} from './builder-mcp-primitives';
import { step1Schema } from './onboarding';
import { onboardingCountrySchema } from './onboarding-country';
import { renameSlugSchema } from './rename-slug';

const store = { storefrontId: id };
const mutation = { ...store, expectedVersion: revision, idempotencyKey: id };
const requestSchemas = {
  list_storefronts: z
    .object({
      cursor: z.string().min(1).max(2048).optional(),
      pageSize: z.number().int().min(1).max(20).default(20),
    })
    .strict(),
  get_storefront_status: z.object(store).strict(),
  create_storefront_draft: z
    .object({
      businessName: z
        .string()
        .min(2)
        .max(200)
        .transform((value, context) => {
          const normalized = step1Schema.shape.businessName.safeParse(value);
          if (!normalized.success) {
            context.addIssue({
              code: 'custom',
              message: 'Invalid business name',
            });
            return z.NEVER;
          }
          return normalized.data;
        }),
      businessType: z.enum(getAllBusinessTypeIds()),
      country: onboardingCountrySchema.pipe(z.string()),
      requestedSlug: renameSlugSchema.shape.new_slug.refine(
        (value) => !isReservedMerchantSlug(value)
      ),
      brandBrief: z.string().trim().max(4000).optional(),
      idempotencyKey: id,
    })
    .strict()
    .refine(
      (value) =>
        value.businessType !== 'other' || (value.brandBrief?.length ?? 0) >= 3,
      'Describe the other business type in the brand brief'
    ),
  update_storefront_draft: z
    .object({
      ...mutation,
      pageSlug: z.literal('home'),
      instructions: z.string().trim().min(1).max(4000),
    })
    .strict(),
  get_storefront_operation: z.object({ ...store, operationId: id }).strict(),
  apply_storefront_operation: z
    .object({ ...mutation, operationId: id })
    .strict(),
  preview_storefront: z
    .object({
      ...store,
      pageSlug: z.literal('home'),
      expectedVersion: revision,
    })
    .strict(),
  publish_storefront: z.object(mutation).strict(),
} as const;
export const builderInputSchemas = requestSchemas;
export type BuilderToolName = keyof typeof builderInputSchemas;
export type ListInput = z.infer<typeof requestSchemas.list_storefronts>;
export type StatusInput = z.infer<typeof requestSchemas.get_storefront_status>;
export type CreateDraftInput = z.infer<
  typeof requestSchemas.create_storefront_draft
>;
export type UpdateDraftInput = z.infer<
  typeof requestSchemas.update_storefront_draft
>;
export type OperationInput = z.infer<
  typeof requestSchemas.get_storefront_operation
>;
export type ApplyOperationInput = z.infer<
  typeof requestSchemas.apply_storefront_operation
>;
export type PreviewInput = z.infer<typeof requestSchemas.preview_storefront>;
export type PublishInput = z.infer<typeof requestSchemas.publish_storefront>;
export type BuilderToolInput<T extends BuilderToolName> = z.infer<
  (typeof requestSchemas)[T]
>;
export { BUILDER_REQUEST_BYTES } from './builder-mcp-primitives';
/** Run at ingress before enqueueing or invoking any business service. */
export function parseBuilderRequest<T extends BuilderToolName>(
  tool: T,
  body: string
) {
  if (!Object.hasOwn(requestSchemas, tool))
    return { ok: false as const, error: builderError('INVALID_REQUEST') };
  if (new TextEncoder().encode(body).byteLength > BUILDER_REQUEST_BYTES)
    return { ok: false as const, error: builderError('INVALID_REQUEST') };
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false as const, error: builderError('INVALID_REQUEST') };
  }
  if (
    value &&
    typeof value === 'object' &&
    'pageSlug' in value &&
    value.pageSlug !== 'home'
  )
    return { ok: false as const, error: builderError('UNSUPPORTED_PAGE') };
  const result = requestSchemas[tool].safeParse(value);
  return result.success
    ? { ok: true as const, data: result.data as BuilderToolInput<T> }
    : { ok: false as const, error: builderError('INVALID_REQUEST') };
}
