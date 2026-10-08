import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { resolveEditOrderDate } from '@/lib/edit-order-date';
import {
  buildEditOrderPayload,
  type EditableOrderRecord,
  isOrderFinanciallyLocked,
  mapOrderItemsForEdit,
  readShippingAddressValue,
} from '@/lib/edit-order-payload';
import { resolvePrefillDate } from '@/lib/edit-order-prefill-date';
import { useUpdateOrder } from './orders/useUpdateOrder';
import { useNewOrderController } from './useNewOrderController';
import { useOrder } from './useOrders';

export function useEditOrderController() {
  const rawParams = useLocalSearchParams<{ id?: string }>();
  const orderId = Array.isArray(rawParams.id) ? rawParams.id[0] : rawParams.id;
  const baseController = useNewOrderController({
    autoApplyVat: false,
    autoSelectDefaultBranch: false,
    initialSelectedChannel: null,
  });
  const orderQuery = useOrder(orderId ?? '');
  const updateOrderMutation = useUpdateOrder();
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [preservedGiftWrappingFee, setPreservedGiftWrappingFee] = useState(0);
  const prefilledOrderIdRef = useRef<string | null>(null);
  const order = orderQuery.data as EditableOrderRecord | undefined;
  const {
    setCustomer,
    setDate,
    setDeliveryInfo,
    setDiscount,
    setIsVatApplied,
    setNotes,
    setOrderItems,
    setSameAsCustomer,
    setSelectedBranchId,
    setSelectedChannel,
    setShippingFee,
    setTaxes,
  } = baseController;

  useEffect(() => {
    if (!order || prefilledOrderIdRef.current === order.id) {
      return;
    }

    prefilledOrderIdRef.current = order.id;
    const address = readShippingAddressValue(order.shipping_address, 'address');
    const explicitShippingName = readShippingAddressValue(
      order.shipping_address,
      'name'
    );
    const explicitShippingPhone = readShippingAddressValue(
      order.shipping_address,
      'phone'
    );
    const customerName = order.customer_name ?? '';
    const customerPhone = order.customer_phone ?? '';
    const shippingName = explicitShippingName || customerName;
    const shippingPhone = explicitShippingPhone || customerPhone;
    const sameAsCustomer =
      shippingName === customerName && shippingPhone === customerPhone;

    const prefillDate = resolvePrefillDate({
      invoiceDay: order.invoice_issue_date,
      savedInstant: order.transaction_date ?? order.created_at,
      source: order.source,
    });
    if (prefillDate) {
      setDate(prefillDate);
    }

    setCustomer({
      address,
      email: order.customer_email ?? '',
      id: order.customer_id ?? null,
      name: customerName,
      phone: customerPhone,
    });
    setSelectedBranchId(
      typeof order.branch_id === 'string' ? order.branch_id : null
    );
    setSelectedChannel(order.source ?? null);
    setOrderItems(mapOrderItemsForEdit(order.items));
    setNotes(order.notes ?? '');
    setDiscount(Number(order.discount_amount) || 0);
    setShippingFee(Number(order.shipping_fee) || 0);
    setTaxes(Number(order.tax_amount) || 0);
    // Edit mode must preserve the stored tax_amount until the merchant
    // explicitly changes tax/VAT; tax_basis alone is not proof VAT was applied.
    setIsVatApplied(false);
    setPreservedGiftWrappingFee(Number(order.gift_wrapping_fee) || 0);
    setSameAsCustomer(sameAsCustomer);
    setDeliveryInfo({
      address,
      city: readShippingAddressValue(order.shipping_address, 'city'),
      name: shippingName,
      phone: shippingPhone,
      state: readShippingAddressValue(order.shipping_address, 'state'),
    });
  }, [
    order,
    setCustomer,
    setDate,
    setDeliveryInfo,
    setDiscount,
    setIsVatApplied,
    setNotes,
    setOrderItems,
    setSameAsCustomer,
    setSelectedBranchId,
    setSelectedChannel,
    setShippingFee,
    setTaxes,
  ]);

  const handleSubmit = async () => {
    if (updateOrderMutation.isPending) {
      return;
    }

    if (!orderId) {
      Alert.alert('Invalid order', 'This order link is missing an id.');
      return;
    }

    if (
      order?.shipping_status === 'cancelled' ||
      order?.shipping_status === 'returned'
    ) {
      Alert.alert(
        'Order closed',
        'This order is cancelled or returned and cannot be edited.'
      );
      return;
    }

    if (!baseController.customer.name.trim()) {
      Alert.alert('Required', 'Please select a customer for this order');
      return;
    }

    if (baseController.orderItems.length === 0) {
      Alert.alert('Required', 'Please add at least one product');
      return;
    }

    const orderDate = resolveEditOrderDate({
      currentDate: baseController.date,
      hasSavedOrder: Boolean(order),
      savedCreatedAt: order?.created_at,
      savedDay: order?.invoice_issue_date,
      savedSource: order?.source,
      savedTransactionDate: order?.transaction_date,
    });

    if (orderDate && orderDate.getTime() > Date.now()) {
      Alert.alert('Invalid date', 'Order date cannot be in the future.');
      return;
    }

    try {
      await updateOrderMutation.mutateAsync({
        orderId,
        payload: buildEditOrderPayload({
          customer: baseController.customer,
          customerSelectionChanged: order
            ? order.customer_id !== baseController.customer.id
            : false,
          deliveryInfo: baseController.deliveryInfo,
          orderDate,
          discount: baseController.discount,
          notes: baseController.notes,
          notifyCustomer,
          orderItems: baseController.orderItems,
          sameAsCustomer: baseController.sameAsCustomer,
          selectedBranchId: baseController.selectedBranchId,
          selectedChannel: baseController.selectedChannel,
          shippingFee: baseController.shippingFee,
          taxesToUse: baseController.taxesToUse,
        }),
      });
      baseController.setShowSuccessModal(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update order';
      Alert.alert('Error', message);
    }
  };

  return {
    ...baseController,
    editError: orderQuery.error,
    handleSubmit,
    isEditError: orderQuery.isError,
    isEditLoading: orderQuery.isLoading,
    isFinancialLocked: order ? isOrderFinanciallyLocked(order) : false,
    isSubmitting: updateOrderMutation.isPending,
    notifyCustomer,
    order,
    orderId,
    setNotifyCustomer,
    total:
      (order?.tax_basis === 'inclusive'
        ? baseController.total - baseController.taxesToUse
        : baseController.total) + preservedGiftWrappingFee,
    updateOrderMutation,
    viewOrder: () => {
      if (orderId) {
        router.replace(`/order/${orderId}`);
      }
    },
  };
}
