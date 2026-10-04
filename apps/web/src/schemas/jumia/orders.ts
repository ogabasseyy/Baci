/**
 * Jumia Vendor Center API — Order schemas
 */

import { z } from 'zod';
import {
  CountryInfoSchema,
  CurrencyAmountSchema,
  ShippingAddressSchema,
} from '@/schemas/jumia/shared';

// ── Orders ──

const JumiaOrderSchema = z.object({
  id: z.string().min(1),
  shopIds: z.array(z.string().min(1)),
  totalItems: z.int().nonnegative(),
  packedItems: z.int().nonnegative(),
  isPrepayment: z.boolean(),
  hasMultipleStatus: z.boolean(),
  hasItemsFulfilledByJumia: z.boolean(),
  pendingSince: z.iso.datetime({ offset: true }).optional(),
  status: z.string().min(1),
  deliveryOption: z.string().min(1),
  number: z.string().min(1),
  totalAmount: CurrencyAmountSchema,
  country: CountryInfoSchema,
  shippingAddress: ShippingAddressSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  totalAmountLocal: CurrencyAmountSchema,
});

export const JumiaOrdersResponseSchema = z.object({
  orders: z.array(JumiaOrderSchema),
  isLastPage: z.boolean(),
  nextToken: z.string().nullable().optional(),
});

// ── Order Items ──

const JumiaOrderItemSchema = z.object({
  id: z.string().min(1),
  shopId: z.string().min(1),
  product: z.object({
    name: z.string(),
    sellerSku: z.string(),
    imageUrl: z.url(),
  }),
  status: z.string().min(1),
  trackingNumber: z.string(),
  // Jumia API returns empty strings for tracking URLs when not yet available
  trackingUrl: z.union([z.url(), z.literal('')]).optional(),
  shipmentType: z.string(),
  deliveryOption: z.string().min(1),
  isFulfilledByJumia: z.boolean(),
  itemPrice: z.number().nonnegative(),
  paidPrice: z.number().nonnegative(),
  shippingAmount: z.number().nonnegative(),
  itemPriceLocal: z.number().nonnegative(),
  paidPriceLocal: z.number().nonnegative(),
  shippingAmountLocal: z.number().nonnegative(),
  exchangeRate: z.number().positive(),
  country: CountryInfoSchema,
  taxAmount: z.number().nonnegative(),
  voucherAmount: z.number().nonnegative(),
  shippingAddress: ShippingAddressSchema,
});

export const JumiaOrderItemsResponseSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  items: z.array(JumiaOrderItemSchema),
});

// ── Shipment Providers ──

export const JumiaShipmentProvidersResponseSchema = z.object({
  orderItems: z.array(
    z.object({
      id: z.string().min(1),
      shipmentProviders: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          trackingCodeRequired: z.boolean(),
        })
      ),
    })
  ),
});

// ── Inferred types ──

export type JumiaOrdersResponse = z.infer<typeof JumiaOrdersResponseSchema>;
export type JumiaOrder = z.infer<typeof JumiaOrderSchema>;
export type JumiaOrderItemsResponse = z.infer<
  typeof JumiaOrderItemsResponseSchema
>;
export type JumiaOrderItem = z.infer<typeof JumiaOrderItemSchema>;
export type JumiaShipmentProvidersResponse = z.infer<
  typeof JumiaShipmentProvidersResponseSchema
>;
