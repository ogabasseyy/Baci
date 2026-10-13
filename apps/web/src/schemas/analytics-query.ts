import { z } from 'zod';

const isoDateTime = z.iso.datetime({ offset: true });

export const analyticsQuerySchema = z
  .object({
    cacheBust: z
      .string()
      .regex(/^\d{1,10}$/)
      .optional(),
    endDate: isoDateTime.optional(),
    startDate: isoDateTime.optional(),
    branchId: z.uuid('Invalid branch id').optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.startDate && !value.endDate) {
      return;
    }

    if (!value.startDate || !value.endDate) {
      if (!value.startDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'startDate and endDate must be provided together',
          path: ['startDate'],
        });
      }
      if (!value.endDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'startDate and endDate must be provided together',
          path: ['endDate'],
        });
      }
      return;
    }

    const startMs = Date.parse(value.startDate);
    const endMs = Date.parse(value.endDate);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs > endMs) {
      ctx.addIssue({
        code: 'custom',
        message: 'startDate must be on or before endDate',
        path: ['startDate'],
      });
    }
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
