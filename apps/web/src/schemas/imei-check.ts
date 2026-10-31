import {
  IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  isImeiServiceTierKey,
} from '@baci/shared/imei';
import { z } from 'zod';
import { RouteIdentifierSchema } from './route-identifier';

export const imeiCheckSchema = z
  .object({
    clientCapabilities: z
      .array(z.string().trim().min(1).max(64))
      .max(10)
      .optional()
      .default([]),
    device: z.enum(['smartphone', 'tablet', 'laptop', 'watch']).optional(),
    expectedUserId: z.string().uuid().optional(),
    previousLookupId: z.string().uuid().optional(),
    // Accepts an IMEI (15 digits) or an Apple serial (8–14 alphanumeric). The
    // route enforces the exact rule for the selected tier's identifier type.
    imei: z
      .string()
      .regex(/^[A-Za-z0-9]{8,15}$/, 'Enter a valid IMEI or serial number'),
    merchantSlug: RouteIdentifierSchema.optional(),
    tier: z
      .string()
      .default('full')
      .refine(
        (value): value is ImeiServiceTierKey => isImeiServiceTierKey(value),
        {
          error: 'Invalid service tier',
        }
      ),
  })
  .superRefine((value, context) => {
    if (
      value.device &&
      isImeiServiceTierKey(value.tier) &&
      !IMEI_SERVICE_TIERS[value.tier].deviceCategories.some(
        (category) => category === value.device
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Selected device is not supported by this service tier',
        path: ['device'],
      });
    }
  });

export type ImeiCheckInput = z.infer<typeof imeiCheckSchema>;
