/**
 * Order Status Constants
 * Single source of truth for status labels, colors, and transitions
 */

import type { PaymentStatus, ShippingStatus } from '../types/order';

// Shipping Status Configuration
export const SHIPPING_STATUS_CONFIG: Record<
  ShippingStatus,
  { label: string; colorKey: string; icon: string }
> = {
  pending: {
    label: 'Unfulfilled',
    colorKey: 'pending',
    icon: 'receipt-outline',
  },
  processing: {
    label: 'Processing',
    colorKey: 'processing',
    icon: 'construct-outline',
  },
  shipped: {
    label: 'Shipped',
    colorKey: 'shipped',
    icon: 'car-outline',
  },
  delivered: {
    label: 'Delivered',
    colorKey: 'delivered',
    icon: 'checkmark-done-outline',
  },
  cancelled: {
    label: 'Cancelled',
    colorKey: 'cancelled',
    icon: 'close-circle-outline',
  },
  returned: {
    label: 'Returned',
    colorKey: 'returned',
    icon: 'return-down-back-outline',
  },
};

// Payment Status Configuration
export const PAYMENT_STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; colorKey: string }
> = {
  paid: { label: 'Paid', colorKey: 'success' },
  unpaid: { label: 'Unpaid', colorKey: 'error' },
  pending: { label: 'Awaiting Payment', colorKey: 'pending' },
  failed: { label: 'Failed', colorKey: 'error' },
  refunded: { label: 'Refunded', colorKey: 'textMuted' },
  partially_paid: { label: 'Partial', colorKey: 'warning' },
  bnpl_approved: { label: 'BNPL Approved', colorKey: 'info' },
  bnpl_pending: { label: 'BNPL Pending', colorKey: 'pending' },
  cancelled: { label: 'Cancelled', colorKey: 'textMuted' },
  expired: { label: 'Expired', colorKey: 'textMuted' },
};

// Allowed status transitions (from -> to[])
export const SHIPPING_STATUS_TRANSITIONS: Record<
  ShippingStatus,
  ShippingStatus[]
> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

// Status action labels
export const SHIPPING_STATUS_ACTIONS: Record<
  ShippingStatus,
  { nextStatus: ShippingStatus; label: string; icon: string }[]
> = {
  pending: [
    {
      nextStatus: 'processing',
      label: 'Confirm Order',
      icon: 'checkmark-circle-outline',
    },
    {
      nextStatus: 'cancelled',
      label: 'Cancel Order',
      icon: 'close-circle-outline',
    },
  ],
  processing: [
    { nextStatus: 'shipped', label: 'Ship Order', icon: 'airplane-outline' },
    {
      nextStatus: 'cancelled',
      label: 'Cancel Order',
      icon: 'close-circle-outline',
    },
  ],
  shipped: [
    {
      nextStatus: 'delivered',
      label: 'Mark as Delivered',
      icon: 'checkmark-done-outline',
    },
  ],
  delivered: [
    {
      nextStatus: 'returned',
      label: 'Process Return',
      icon: 'return-down-back-outline',
    },
  ],
  cancelled: [],
  returned: [],
};

// Order source configuration
export const ORDER_SOURCE_CONFIG: Record<
  string,
  { label: string; icon: string; colorKey: string }
> = {
  online_store: {
    label: 'Store',
    icon: 'storefront-outline',
    colorKey: 'gold',
  },
  storefront: { label: 'Store', icon: 'storefront-outline', colorKey: 'gold' },
  whatsapp: { label: 'WhatsApp', icon: 'logo-whatsapp', colorKey: 'whatsapp' },
  instagram: {
    label: 'Instagram',
    icon: 'logo-instagram',
    colorKey: 'instagram',
  },
  web: { label: 'Website', icon: 'globe-outline', colorKey: 'primary' },
  manual: { label: 'Manual', icon: 'create-outline', colorKey: 'textMuted' },
  staff_entry: {
    label: 'Staff Entry',
    icon: 'person-circle-outline',
    colorKey: 'info',
  },
  facebook: { label: 'Facebook', icon: 'logo-facebook', colorKey: 'facebook' },
  tiktok: { label: 'TikTok', icon: 'logo-tiktok', colorKey: 'tiktok' },
  jumia: { label: 'Jumia', icon: 'cart-outline', colorKey: 'warning' },
  jiji: { label: 'Jiji', icon: 'pricetag-outline', colorKey: 'success' },
  konga: { label: 'Konga', icon: 'bag-handle-outline', colorKey: 'secondary' },
  physical: {
    label: 'Physical Sales',
    icon: 'storefront',
    colorKey: 'primary',
  },
};

// Brand colors (hex values)
export const BRAND_COLORS = {
  whatsapp: '#25D366',
  instagram: '#E4405F',
  facebook: '#1877F2',
  tiktok: '#000000',
  jumia: '#F68B1E',
  jiji: '#3DB83A',
  konga: '#ED017F',
} as const;
