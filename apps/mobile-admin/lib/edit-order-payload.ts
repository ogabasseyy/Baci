import type { OrderSource, PaymentStatus, ShippingStatus } from '@baci/shared';
import type {
  CustomerInfo,
  DeliveryInfo,
  OrderItem,
} from '@/components/orders/new-order.types';
import type { UpdateOrderPayload } from '@/hooks/orders/useUpdateOrder';
import { normalizeVariantAttributes } from '@/lib/product-picker-variant-rows';
import {
  sanitizeAddress,
  sanitizeCustomerName,
  sanitizeEmail,
  sanitizeNotes,
  sanitizePhone,
  sanitizeText,
} from '@/lib/sanitize';
import { formatPickerDateInput } from '@/lib/transaction-review-inputs';

const PAID_LIKE_STATUSES: ReadonlySet<string> = new Set<PaymentStatus>([
  'paid',
  'partially_paid',
  'bnpl_approved',
  'refunded',
]);

const FULFILLED_OR_TERMINAL_STATUSES: ReadonlySet<string> =
  new Set<ShippingStatus>(['shipped', 'delivered', 'cancelled', 'returned']);

function hasPaymentLockStatus(
  status: PaymentStatus | string | null | undefined
): status is PaymentStatus {
  return typeof status === 'string' && PAID_LIKE_STATUSES.has(status);
}

function hasFulfilledOrTerminalStatus(
  status: ShippingStatus | string | null | undefined
): status is ShippingStatus {
  return (
    typeof status === 'string' && FULFILLED_OR_TERMINAL_STATUSES.has(status)
  );
}

interface EditabilityOrderState {
  amount_paid?: number | null;
  payment_status?: PaymentStatus | string | null;
  shipping_status?: ShippingStatus | string | null;
  wallet_amount_used?: number | null;
}

export type EditableOrderRecord = Record<string, unknown> & {
  amount_paid?: number | null;
  transaction_date?: string | null;
  created_at?: string;
  customer_email?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_amount?: number | null;
  id: string;
  items?: unknown[];
  notes?: string | null;
  payment_status?: PaymentStatus;
  shipping_address?: unknown;
  shipping_fee?: number | null;
  shipping_status?: ShippingStatus;
  source?: OrderSource | null;
  gift_wrapping_fee?: number | null;
  tax_amount?: number | null;
  tax_basis?: 'exclusive' | 'inclusive' | string | null;
  total?: number | null;
  wallet_amount_used?: number | null;
};

export interface EditOrderPayloadDraft {
  customer: CustomerInfo;
  customerSelectionChanged?: boolean;
  deliveryInfo: DeliveryInfo;
  discount: number;
  orderDate?: Date;
  notes: string;
  notifyCustomer: boolean;
  orderItems: OrderItem[];
  sameAsCustomer: boolean;
  selectedBranchId?: string | null;
  selectedChannel: OrderSource | null;
  shippingFee: number;
  taxesToUse: number;
}

function getOrderItemProductMatchStatus(item: OrderItem) {
  if (item.is_custom) {
    return 'custom';
  }

  if (item.product_match_status) {
    return item.product_match_status;
  }

  return item.product_id ? 'linked' : 'custom';
}

function getSavedProductMatchStatus(value: unknown, productId: string | null) {
  return value === 'custom' || value === 'linked' || value === 'unreviewed'
    ? value
    : productId
      ? 'linked'
      : 'custom';
}

export function isOrderFinanciallyLocked(
  order: EditabilityOrderState
): boolean {
  return Boolean(
    Number(order.amount_paid) > 0 ||
      Number(order.wallet_amount_used) > 0 ||
      hasPaymentLockStatus(order.payment_status) ||
      hasFulfilledOrTerminalStatus(order.shipping_status)
  );
}

export function buildEditOrderPayload({
  customer,
  customerSelectionChanged = false,
  deliveryInfo,
  discount,
  notes,
  notifyCustomer,
  orderDate,
  orderItems,
  sameAsCustomer,
  selectedBranchId,
  selectedChannel,
  shippingFee,
  taxesToUse,
}: EditOrderPayloadDraft): UpdateOrderPayload {
  const sanitizedCustomerName =
    sanitizeCustomerName(customer.name) || 'Walk-in Customer';
  const sanitizedCustomerEmail = customer.email
    ? sanitizeEmail(customer.email)
    : null;
  const sanitizedCustomerPhone = customer.phone
    ? sanitizePhone(customer.phone)
    : null;
  const sanitizedCustomerAddress = customer.address
    ? sanitizeAddress(customer.address)
    : '';
  const deliveryAddress = sanitizeAddress(deliveryInfo.address);
  const preservesCustomerLocality =
    sameAsCustomer &&
    !customerSelectionChanged &&
    sanitizedCustomerAddress.length > 0 &&
    deliveryAddress === sanitizedCustomerAddress;
  const shippingAddress = sameAsCustomer
    ? {
        address: sanitizedCustomerAddress,
        city: preservesCustomerLocality
          ? sanitizeText(deliveryInfo.city, 100) || null
          : null,
        name: sanitizedCustomerName,
        phone: sanitizedCustomerPhone || '',
        state: preservesCustomerLocality
          ? sanitizeText(deliveryInfo.state, 100) || null
          : null,
      }
    : {
        address: deliveryAddress,
        city: sanitizeText(deliveryInfo.city, 100) || null,
        name: sanitizeCustomerName(deliveryInfo.name),
        phone: sanitizePhone(deliveryInfo.phone),
        state: sanitizeText(deliveryInfo.state, 100) || null,
      };

  return {
    // Mirror order creation: the picked calendar day is explicit user
    // intent, sent alongside the UTC instant so the server never has to
    // re-derive the day in the merchant timezone (which can shift it when
    // device and merchant timezones straddle midnight).
    ...(orderDate
      ? {
          transaction_date: orderDate.toISOString(),
          transaction_date_day: formatPickerDateInput(orderDate),
        }
      : {}),
    branch_id: selectedBranchId || null,
    customer: {
      email: sanitizedCustomerEmail,
      id: customer.id,
      name: sanitizedCustomerName,
      phone: sanitizedCustomerPhone,
    },
    discount_amount: discount,
    items: orderItems.map((item) => ({
      condition: item.condition ?? null,
      image_url: item.image_url ?? null,
      item_description: item.details ? sanitizeText(item.details, 1000) : null,
      name: sanitizeText(item.name, 200),
      price: item.price,
      product_id: item.is_custom ? null : item.product_id,
      product_match_status: getOrderItemProductMatchStatus(item),
      quantity: item.quantity,
      variant_attributes: item.is_custom
        ? null
        : (item.variant_attributes ?? null),
      variant_id: item.is_custom ? null : (item.variant_id ?? null),
      variant_name: item.is_custom ? null : (item.variant_name ?? null),
    })),
    notes: notes.trim() ? sanitizeNotes(notes) : null,
    notify_customer: notifyCustomer,
    shipping_address: shippingAddress,
    shipping_fee: shippingFee,
    source: selectedChannel,
    tax_amount: taxesToUse,
  };
}

export function readShippingAddressValue(
  shippingAddress: unknown,
  key: 'address' | 'city' | 'name' | 'phone' | 'state'
): string {
  if (!shippingAddress || typeof shippingAddress !== 'object') {
    return '';
  }

  const record = shippingAddress as Record<string, unknown>;
  const value =
    key === 'address' ? (record.address ?? record.address_line1) : record[key];
  return typeof value === 'string' ? value : '';
}

export function mapOrderItemsForEdit(items: unknown): OrderItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const record = item as Record<string, unknown>;
    const productId =
      typeof record.product_id === 'string' ? record.product_id : null;
    const variantId =
      typeof record.variant_id === 'string' ? record.variant_id : null;
    const productMatchStatus = getSavedProductMatchStatus(
      record.product_match_status,
      productId
    );
    const id =
      typeof record.id === 'string'
        ? record.id
        : `${productId ?? 'custom'}::${variantId ?? 'no-variant'}::${index}`;

    return {
      condition:
        typeof record.condition === 'string' ? record.condition : undefined,
      details:
        typeof record.details === 'string'
          ? record.details
          : typeof record.item_description === 'string'
            ? record.item_description
            : undefined,
      id,
      image_url:
        typeof record.image_url === 'string' ? record.image_url : undefined,
      is_custom: productMatchStatus === 'custom',
      name: typeof record.name === 'string' ? record.name : 'Product',
      price: Number(record.price) || 0,
      product_id: productId,
      product_match_status: productMatchStatus,
      quantity: Number(record.quantity) || 1,
      variant_attributes: normalizeVariantAttributes(record.variant_attributes),
      variant_id: variantId,
      variant_name:
        typeof record.variant_name === 'string' ? record.variant_name : null,
    };
  });
}
