import { z } from 'zod';
import { BUILDER_ERROR_MESSAGES } from '@/lib/builder-connector/errors';
import {
  BUILDER_EDITOR_URL,
  builderRevisionSchema as revision,
} from './builder-mcp-primitives';
export const builderFailureSchema = z
  .object({
    status: z.literal('error'),
    code: z.enum(
      Object.keys(BUILDER_ERROR_MESSAGES) as [
        keyof typeof BUILDER_ERROR_MESSAGES,
        ...(keyof typeof BUILDER_ERROR_MESSAGES)[],
      ]
    ),
    error: z.string().max(500),
    currentVersion: revision.optional(),
    editorUrl: z.literal(BUILDER_EDITOR_URL).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.code === 'STALE_DRAFT'
        ? value.currentVersion !== undefined
        : value.currentVersion === undefined) &&
      (value.code === 'UNSUPPORTED_TEMPLATE'
        ? value.editorUrl === BUILDER_EDITOR_URL
        : value.editorUrl === undefined),
    'Error details must match the error code'
  );
