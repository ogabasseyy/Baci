import type { OrderSource, PaymentStatus } from '@baci/shared';
import type { QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type {
  CustomerInfo,
  DeliveryInfo,
  OrderItem,
  ShippingAddress,
} from '@/components/orders/new-order.types';
import { createManualOrderWithItems } from '@/lib/manual-order-persistence';
import { normalizeMerchantCurrency } from '@/lib/merchant-currency';
import {
  sanitizeAddress,
  sanitizeCustomerName,
  sanitizeEmail,
  sanitizeNotes,
  sanitizePhone,
  sanitizeText,
} from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';

interface SubmitNewOrderParams {
  customer: CustomerInfo;
  deliveryInfo: DeliveryInfo;
  discount: number;
  merchantId?: string;
  merchantCurrency?: string | null;
  notes: string;
  orderDate: Date;
  orderItems: OrderItem[];
  partialAmount: string;
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  queryClient: QueryClient;
  sameAsCustomer: boolean;
  selectedChannel: OrderSource;
  selectedBranchId?: string | null;
  setIsSubmitting: (value: boolean) => void;
  setLastOrderId: (value: string | null) => void;
  setShowSuccessModal: (value: boolean) => void;
  shippingFee: number;
  subtotal: number;
  taxesToUse: number;
  total: number;
  userId?: string;
  submittingRef: MutableRefObject<boolean>;
}

const ORDER_DATE_FUTURE_TOLERANCE_MS = 60_000;

export async function submitNewOrder({
  customer,
  deliveryInfo,
  discount,
  merchantId,
  merchantCurrency,
  notes,
  orderDate,
  orderItems,
  partialAmount,
  paymentMethod,
  paymentStatus,
  queryClient,
  sameAsCustomer,
  selectedChannel,
  selectedBranchId,
  setIsSubmitting,
  setLastOrderId,
  setShowSuccessModal,
  shippingFee,
  subtotal,
  taxesToUse,
  total,
  userId,
  submittingRef,
}: SubmitNewOrderParams) {
  if (submittingRef.current) {
    return;
  }
  if (!customer.id || !customer.name) {
    Alert.alert('Required', 'Please select a customer for this order');
    return;
  }
  if (!merchantId) {
    Alert.alert(
      'Unavailable',
      'Merchant information is still loading. Please try again.'
    );
    return;
  }
  if (orderItems.length === 0) {
    Alert.alert('Required', 'Please add at least one product');
    return;
  }

  submittingRef.current = true;
  setIsSubmitting(true);

  try {
    const now = new Date();
    validateOrderDate(orderDate, now);
    const orderDateIso = orderDate.toISOString();
    const orderNumber = generateOrderNumber(orderDate);
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
    const sanitizedNotes = notes.trim() ? sanitizeNotes(notes) : null;
    const normalizedMerchantCurrency =
      normalizeMerchantCurrency(merchantCurrency);
    if (merchantCurrency?.trim() && !normalizedMerchantCurrency) {
      console.warn('[submitNewOrder] Unsupported merchant currency fallback', {
        merchantCurrency,
        fallbackCurrency: 'NGN',
      });
    }
    const orderCurrency = normalizedMerchantCurrency ?? 'NGN';
    const parsedPartialAmount = Number.parseFloat(partialAmount);
    if (
      paymentStatus === 'partially_paid' &&
      (Number.isNaN(parsedPartialAmount) || parsedPartialAmount < 0)
    ) {
      throw new Error('Invalid payment amount');
    }
    const shippingAddress: ShippingAddress = sameAsCustomer
      ? {
          address: sanitizedCustomerAddress,
          name: sanitizedCustomerName,
          phone: sanitizedCustomerPhone || '',
          city: sanitizeText(customer.city ?? '', 100),
          state: sanitizeText(customer.state ?? '', 100),
          country: sanitizeText(customer.country ?? '', 100),
          countryCode: sanitizeText(customer.countryCode ?? '', 10),
          postalCode: sanitizeText(customer.postalCode ?? '', 30),
          latitude: customer.latitude,
          longitude: customer.longitude,
        }
      : {
          address: sanitizeAddress(deliveryInfo.address),
          city: sanitizeText(deliveryInfo.city, 100),
          name: sanitizeCustomerName(deliveryInfo.name),
          phone: sanitizePhone(deliveryInfo.phone),
          state: sanitizeText(deliveryInfo.state, 100),
          country: sanitizeText(deliveryInfo.country ?? '', 100),
          countryCode: sanitizeText(deliveryInfo.countryCode ?? '', 10),
          postalCode: sanitizeText(deliveryInfo.postalCode ?? '', 30),
          latitude: deliveryInfo.latitude,
          longitude: deliveryInfo.longitude,
        };
    const validatedBranchId = await validateSelectedBranch(
      selectedBranchId,
      merchantId
    );

    const createdOrder = await createManualOrderWithItems(
      {
        deleteOrder: (orderId) =>
          supabase
            .from('orders')
            .delete()
            .eq('id', orderId)
            .eq('merchant_id', merchantId),
        insertOrder: (order) =>
          supabase.from('orders').insert(order).select('id').single(),
        insertOrderItems: (items) => supabase.from('order_items').insert(items),
      },
      {
        buildItems: (orderId) =>
          orderItems.map((item) => ({
            condition: item.condition ?? null,
            item_description: item.details
              ? sanitizeText(item.details, 1000)
              : null,
            name: sanitizeText(item.name, 200),
            order_id: orderId,
            price: item.price,
            product_id: item.is_custom ? null : item.product_id,
            product_match_status:
              item.product_match_status ??
              (item.is_custom ? 'custom' : 'linked'),
            quantity: item.quantity,
            variant_id: item.is_custom ? null : (item.variant_id ?? null),
            variant_attributes:
              item.is_custom || !item.variant_id
                ? {}
                : (item.variant_attributes ?? {}),
            variant_name:
              item.is_custom || !item.variant_id
                ? null
                : (item.variant_name ?? null),
          })),
        order: {
          amount_paid:
            paymentStatus === 'partially_paid'
              ? parsedPartialAmount
              : paymentStatus === 'paid'
                ? total
                : 0,
          branch_id: validatedBranchId,
          currency: orderCurrency,
          customer_email: sanitizedCustomerEmail,
          customer_id: customer.id,
          customer_name: sanitizedCustomerName,
          customer_phone: sanitizedCustomerPhone,
          discount_amount: discount,
          merchant_id: merchantId,
          notes: sanitizedNotes,
          order_number: orderNumber,
          payment_method:
            paymentStatus === 'paid' || paymentStatus === 'partially_paid'
              ? paymentMethod
              : null,
          payment_status: paymentStatus,
          recorded_by_user_id: userId || null,
          shipping_address: shippingAddress,
          shipping_fee: shippingFee,
          shipping_status: 'pending',
          source: selectedChannel,
          subtotal,
          tax_amount: taxesToUse,
          total,
          transaction_date: orderDateIso,
        },
      }
    );

    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['order-counts'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });

    setLastOrderId(createdOrder.id);
    setShowSuccessModal(true);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Failed to create order';
    Alert.alert('Error', message);
  } finally {
    submittingRef.current = false;
    setIsSubmitting(false);
  }
}

async function validateSelectedBranch(
  selectedBranchId: string | null | undefined,
  merchantId: string
) {
  if (!selectedBranchId) {
    return null;
  }

  const { data, error } = await supabase
    .from('branches')
    .select('id')
    .eq('id', selectedBranchId)
    .eq('merchant_id', merchantId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw new Error('Failed to validate selected branch');
  }
  if (!data) {
    throw new Error('Selected branch is not available for this merchant');
  }

  return data.id;
}

function validateOrderDate(orderDate: Date, now: Date) {
  if (Number.isNaN(orderDate.getTime())) {
    throw new Error('Invalid order date');
  }

  if (orderDate.getTime() > now.getTime() + ORDER_DATE_FUTURE_TOLERANCE_MS) {
    throw new Error('Order date cannot be in the future');
  }
}

function generateOrderNumber(date: Date) {
  const prefix = 'ORD';
  const datePart = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
  const randomPart = Crypto.randomUUID()
    .replace(/-/g, '')
    .substring(0, 6)
    .toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}
