/**
 * Jumia Vendor Center API — Fulfillment schemas (pack, ready-to-ship, cancel,
 * print labels)
 */

import { z } from 'zod';
import {
  FulfillmentErrorItemSchema,
  FulfillmentPackageSchema,
  ReadyToShipPackageSchema,
} from '@/schemas/jumia/shared';

const BASE64_LABEL_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PDF_DATA_URL_PATTERN =
  /^data:application\/pdf;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i;

/** Shared cancellation-reason shape used in cancel success/error items. */
const JumiaCancellationReason = z.object({
  id: z.string(),
  description: z.string(),
});

// ── Pack V2 ──

export const JumiaPackV2ResponseSchema = z
  .object({
    success: z
      .object({
        packages: z.array(FulfillmentPackageSchema),
        total: z.number(),
      })
      .optional(),
    error: z
      .object({
        packages: z.array(
          z.object({
            orderItems: z.array(z.string().min(1)).min(1),
            error: z.string(),
          })
        ),
        total: z.number(),
      })
      .optional(),
  })
  .refine((data) => data.success || data.error, {
    error: 'Response must contain success or error',
  });

// ── Ready to Ship ──

export const JumiaReadyToShipResponseSchema = z
  .object({
    success: z
      .object({
        packages: z.array(ReadyToShipPackageSchema),
        total: z.number(),
      })
      .optional(),
    error: z
      .object({
        orderItems: z.array(FulfillmentErrorItemSchema),
        total: z.number(),
      })
      .optional(),
  })
  .refine((data) => data.success || data.error, {
    error: 'Response must contain success or error',
  });

// ── Cancel ──

export const JumiaCancelResponseSchema = z
  .object({
    success: z
      .object({
        orderItems: z.array(
          z.object({
            id: z.string(),
            countryCode: z.string().regex(/^[A-Z]{2}$/),
            cancellationReason: JumiaCancellationReason,
          })
        ),
        total: z.number(),
      })
      .optional(),
    error: z
      .object({
        orderItems: z.array(
          z.object({
            id: z.string(),
            cancellationReason: JumiaCancellationReason.optional(),
            response: z
              .object({
                code: z.string(),
                message: z.string(),
              })
              .optional(),
          })
        ),
        total: z.number(),
      })
      .optional(),
  })
  .refine((data) => data.success || data.error, {
    error: 'Response must contain success or error',
  });

// ── Print Labels ──

export const JumiaPrintLabelsResponseSchema = z
  .object({
    success: z
      .object({
        labels: z.array(
          z.object({
            orderItemIds: z.array(z.string().min(1)).min(1),
            trackingNumber: z.string(),
            countryCode: z.string().regex(/^[A-Z]{2}$/),
            label: z
              .string()
              .refine(
                (label) =>
                  BASE64_LABEL_PATTERN.test(label) ||
                  PDF_DATA_URL_PATTERN.test(label) ||
                  /^https?:\/\/[^\s]+$/.test(label),
                'Label must be an HTTP(S) URL, PDF data URL, or base64-encoded content'
              ),
          })
        ),
        total: z.number(),
      })
      .optional(),
    error: z
      .object({
        orderItems: z.array(FulfillmentErrorItemSchema),
        total: z.number(),
      })
      .optional(),
  })
  .refine((data) => data.success || data.error, {
    error: 'Response must contain success or error',
  });

// ── Inferred types ──

export type JumiaPackV2Response = z.infer<typeof JumiaPackV2ResponseSchema>;
export type JumiaReadyToShipResponse = z.infer<
  typeof JumiaReadyToShipResponseSchema
>;
export type JumiaCancelResponse = z.infer<typeof JumiaCancelResponseSchema>;
export type JumiaPrintLabelsResponse = z.infer<
  typeof JumiaPrintLabelsResponseSchema
>;
