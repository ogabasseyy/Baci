import { z } from 'zod';

export const ADMIN_AUDIT_MAX_ROWS_PER_REQUEST = 99;

const auditToken = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/, 'Use a lowercase audit token');

const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

const optionalAuditToken = (maxLength: number) =>
  z.preprocess(emptyToUndefined, auditToken(maxLength).optional());

const optionalCursorSource = z.preprocess(
  emptyToUndefined,
  z.enum(['canonical', 'platform']).optional()
);

const optionalCursorId = z.preprocess(
  emptyToUndefined,
  z.string().uuid().optional()
);

const optionalCursorTimestamp = z.preprocess(
  emptyToUndefined,
  z.string().datetime({ offset: true }).optional()
);

const adminAuditQueryBaseSchema = z.object({
  action: optionalAuditToken(100),
  beforeId: optionalCursorId,
  beforeOccurredAt: optionalCursorTimestamp,
  beforeSource: optionalCursorSource,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ADMIN_AUDIT_MAX_ROWS_PER_REQUEST)
    .optional()
    .default(50),
  resourceType: optionalAuditToken(80),
  source: z
    .preprocess(
      emptyToUndefined,
      z.enum(['all', 'canonical', 'platform']).optional()
    )
    .default('all'),
});

export const adminAuditQuerySchema = adminAuditQueryBaseSchema.superRefine(
  (value, context) => {
    const cursorParts = [
      value.beforeOccurredAt,
      value.beforeSource,
      value.beforeId,
    ];
    const hasCursorPart = cursorParts.some(Boolean);
    const hasCompleteCursor = cursorParts.every(Boolean);

    if (hasCursorPart && !hasCompleteCursor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Audit cursor must include timestamp, source, and id',
        path: ['beforeOccurredAt'],
      });
    }
  }
);

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export const adminAuditExportSchema = adminAuditQueryBaseSchema.omit({
  beforeId: true,
  beforeOccurredAt: true,
  beforeSource: true,
  limit: true,
});

export type AdminAuditExportQuery = z.infer<typeof adminAuditExportSchema>;
