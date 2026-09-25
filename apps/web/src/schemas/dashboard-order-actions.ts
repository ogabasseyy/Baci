import { z } from 'zod';
import { AGENTIC_ORDER_SOURCE_FILTER } from '@/app/dashboard/orders/agentic-order-source';
import {
  PAYMENT_STATUSES,
  SHIPPING_STATUSES,
} from '@/app/dashboard/orders/order-statuses';

const PAYMENT_STATUS_FILTER_VALUES = ['All', ...PAYMENT_STATUSES] as const;
const SHIPPING_STATUS_FILTER_VALUES = ['All', ...SHIPPING_STATUSES] as const;

const DashboardOrderMerchantIdSchema = z.string().trim().min(1).max(128);
const DashboardOrderIdentifierSchema = z.string().trim().min(1).max(128);

const DashboardOrderFiltersSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUS_FILTER_VALUES).optional(),
  shippingStatus: z.enum(SHIPPING_STATUS_FILTER_VALUES).optional(),
  search: z.string().trim().max(200).optional(),
  source: z.enum([AGENTIC_ORDER_SOURCE_FILTER, 'jumia']).optional(),
  jumiaIntegrationId: DashboardOrderIdentifierSchema.optional(),
});

export const GetOrdersInputSchema = z.object({
  merchantId: DashboardOrderMerchantIdSchema,
  filters: DashboardOrderFiltersSchema.optional().default({}),
});

export const GetOrderStatsInputSchema = z.object({
  merchantId: DashboardOrderMerchantIdSchema,
});

export const GetOrderInputSchema = z.object({
  merchantId: DashboardOrderMerchantIdSchema,
  orderIdentifier: DashboardOrderIdentifierSchema,
});

export const ResendOrderConfirmationInputSchema = z.object({
  orderId: z.uuid(),
});
