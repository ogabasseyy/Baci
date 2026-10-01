/**
 * Jumia Vendor Center API — Feed schemas
 */

import { z } from 'zod';

export const JumiaFeedCreateResponseSchema = z.object({
  feedId: z.string().min(1),
});

const JumiaFeedItemError = z.object({
  globalMessages: z.array(z.string()).optional(),
  businessClients: z
    .object({
      code: z.string(),
      messages: z.array(z.string()),
    })
    .optional(),
});

const JumiaFeedItem = z.object({
  status: z.string().min(1),
  // Rejected feed items may not include a provider product ID. The route
  // treats an accepted item without one as a provider-contract failure.
  productSid: z.string().min(1).optional(),
  sellerSKU: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  errorMessage: z.string().optional(),
  errors: JumiaFeedItemError.optional(),
});

export const JumiaFeedDetailsResponseSchema = z
  .object({
    feedSid: z.string().min(1),
    status: z.string().min(1),
    feedType: z.string().min(1),
    feedSource: z.string().min(1),
    total: z.int().nonnegative(),
    completed: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    createdBy: z.object({
      sid: z.string().min(1),
      name: z.string().min(1),
      email: z.email(),
    }),
    reportUrl: z.url().nullable().optional(),
    errorMessage: z.string().optional(),
    feedItems: z.array(JumiaFeedItem),
  })
  .refine((d) => d.total >= d.completed + d.failed, {
    path: ['total'],
    error: 'total must be >= completed + failed',
  });

// ── Inferred types ──

export type JumiaFeedCreateResponse = z.infer<
  typeof JumiaFeedCreateResponseSchema
>;
export type JumiaFeedDetailsResponse = z.infer<
  typeof JumiaFeedDetailsResponseSchema
>;
