import { z } from 'zod';

export const jumiaConsignmentGetQuerySchema = z.object({
  integrationId: z.uuid('integrationId must be a valid UUID'),
  sku: z.string().trim().min(1, 'sku is required'),
  businessClientCode: z
    .string()
    .trim()
    .min(1, 'businessClientCode is required'),
});

const consignmentProductSchema = z.object({
  sku: z.string().trim().min(1, 'sku is required'),
  quantity: z.int().positive('quantity must be a positive integer'),
  labelCode: z.string().trim().min(1, 'labelCode must not be empty').optional(),
});

const strictDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
      );
    },
    { error: 'Invalid calendar date' }
  );

export const jumiaConsignmentCreateSchema = z.object({
  integrationId: z.uuid('integrationId must be a valid UUID'),
  businessClientCode: z
    .string()
    .trim()
    .min(1, 'businessClientCode is required'),
  shippingDate: strictDateString,
  products: z
    .array(consignmentProductSchema)
    .min(1, 'At least one product is required'),
  comment: z.string().optional(),
});

export const jumiaConsignmentUpdateSchema = z.object({
  integrationId: z.uuid('integrationId must be a valid UUID'),
  purchaseOrderNumber: z
    .string()
    .trim()
    .min(1, 'purchaseOrderNumber is required'),
  isShipped: z.boolean().optional(),
  trackingNumber: z.string().optional(),
  actualDepartureDate: strictDateString.optional(),
  estimatedArrivalDate: strictDateString.optional(),
  deliveryAgentPhoneNumber: z.string().optional(),
  thirdPartyLogisticsName: z.string().optional(),
});
