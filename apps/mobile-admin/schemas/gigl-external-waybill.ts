import { z } from 'zod';

/** Mirrors the web route's waybill rule so bad input never leaves the phone. */
export const giglExternalWaybillInputSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{4,32}$/, 'Enter the waybill number from the GIG app.');

const fieldMatch = z.enum(['match', 'mismatch', 'unknown']);

export const giglExternalWaybillPreviewSchema = z.object({
  waybill: z.string().min(1),
  linkable: z.boolean(),
  match: z.object({
    name: fieldMatch,
    phone: fieldMatch,
    destination: fieldMatch,
  }),
  order: z.object({
    customerName: z.string().nullable(),
    orderNumber: z.string().nullable(),
  }),
  gig: z
    .object({
      receiverName: z.string().nullable(),
      receiverPhoneLast4: z.string().nullable(),
      destinationState: z.string().nullable(),
      deliveryType: z.enum(['home', 'station']),
      stationAddress: z.string().nullable(),
      trackingStatus: z.string().nullable(),
      lastUpdate: z
        .object({
          description: z.string(),
          location: z.string().nullable(),
          at: z.string(),
        })
        .nullable(),
    })
    .nullable(),
});

export const giglExternalWaybillPreviewResponseSchema = z.object({
  preview: giglExternalWaybillPreviewSchema,
});

export const giglExternalWaybillLinkResponseSchema = z.object({
  success: z.literal(true),
  shipmentId: z.string().min(1),
  trackingNumber: z.string().min(1),
});

export const giglExternalWaybillErrorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
});

export type GiglExternalWaybillPreview = z.infer<
  typeof giglExternalWaybillPreviewSchema
>;
export type GiglExternalWaybillLinkResult = z.infer<
  typeof giglExternalWaybillLinkResponseSchema
>;
