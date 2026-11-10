import type { Order } from '@baci/shared';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import { canUseSelectedShippingProvider } from '@/lib/order-shipment';
import type { ShipmentFlowSheet } from './ShipmentFlowSheet';
export const order = {
  id: 'order',
  merchant_id: 'merchant',
  payment_status: 'paid',
  shipping_status: 'processing',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'customer_checkout',
  selected_quote_id: null,
  shipping_address: null,
} as Order;
export const actions = {
  onClose: vi.fn(),
  onContinueFromDetails: vi.fn(),
  onContinueFromMethod: vi.fn(),
  onConfirmSelfFulfillment: vi.fn(),
  onFulfillmentDetailsChange: vi.fn(),
  onModeChange: vi.fn(),
  onRiderPhoneChange: vi.fn(),
  onSelectSavedRider: vi.fn(),
  onStepBack: vi.fn(),
};
export const props = {
  ...actions,
  canBookGigl: true,
  isGiglOrder: true,
  recoveryOrder: order,
  canUseProvider: canUseSelectedShippingProvider(order),
  fulfillmentDetails: { imei: '', serialNumber: '', items: [] },
  fulfillmentItemIndex: 0,
  hasExistingFulfillment: false,
  isSubmitting: false,
  providerLabel: 'GIG Logistics',
  orderNumber: 'ORD-TEST',
  requiresFulfillment: true,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'self_fulfillment' as const,
  step: 'method' as const,
  visible: true,
};
export type GiglShipping = NonNullable<
  ComponentProps<typeof ShipmentFlowSheet>['giglShipping']
>;
export const recoveryLabel = 'Confirm destination and refresh paid quote';
