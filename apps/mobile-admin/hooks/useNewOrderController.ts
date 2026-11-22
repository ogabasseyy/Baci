import type { OrderSource, PaymentStatus } from '@baci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  createEmptyCustomerInfo,
  createEmptyCustomItemDraft,
  createEmptyDeliveryInfo,
} from '@/components/orders/new-order.defaults';
import type {
  CustomerInfo,
  OrderItem,
  SelectedParentProduct,
} from '@/components/orders/new-order.types';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/hooks/useBranches';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useCreateCustomer } from '@/hooks/useCustomers';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { createNewOrderTotals } from '@/lib/new-order-totals';
import { createNewOrderCustomerActions } from './createNewOrderCustomerActions';
import { createNewOrderProductActions } from './createNewOrderProductActions';
import { submitNewOrder } from './submitNewOrder';
import {
  createChangeEditingItemVariantHandler,
  createResetOrderDraft,
  getSelectableProductRows,
} from './useNewOrderControllerActions';
import type { UseNewOrderControllerOptions } from './useNewOrderControllerOptions';
import { useNewOrderCustomerDraftState } from './useNewOrderCustomerDraftState';
import { useNewOrderLookupData } from './useNewOrderLookupData';
import { useNewOrderUiState } from './useNewOrderUiState';
import { useNewOrderVatState } from './useNewOrderVatState';
import { useOrderBranchSelection } from './useOrderBranchSelection';
import { useQuickAddProductMatches } from './useQuickAddProductMatches';

export function useNewOrderController({
  autoApplyVat = true,
  autoSelectDefaultBranch = true,
  initialSelectedChannel = 'physical',
}: UseNewOrderControllerOptions = {}) {
  const { colors, shadows } = useTheme();
  const { merchant } = useMerchant();
  const { user } = useAuth();
  const { data: branches = [] } = useBranches();
  const { scope } = useBranchScope();
  const queryClient = useQueryClient();
  const createCustomerMutation = useCreateCustomer();
  const [date, setDate] = useState(new Date());
  const [selectedChannel, setSelectedChannel] = useState<OrderSource | null>(
    initialSelectedChannel
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [customer, setCustomer] = useState<CustomerInfo>(
    createEmptyCustomerInfo
  );
  const [customerSelectionRevision, setCustomerSelectionRevision] = useState(0);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Ref-based flag to prevent duplicate submissions (guards against race conditions)
  const isSubmittingRef = useRef(false);
  const uiState = useNewOrderUiState();
  const [discount, setDiscount] = useState(0);
  const [shippingFee, setShippingFee] = useState(0);
  const [taxes, setTaxes] = useState(0);
  const { isVatApplied, isVatRegistered, setIsVatApplied } =
    useNewOrderVatState(autoApplyVat, merchant?.vat_registration_status);
  const [productSearch, setProductSearch] = useState('');
  const [selectedParentProduct, setSelectedParentProduct] =
    useState<SelectedParentProduct>(null);
  const [variantReplacementItemId, setVariantReplacementItemId] = useState<
    string | null
  >(null);
  const customerDraft = useNewOrderCustomerDraftState();
  const {
    customersData,
    customersQuery,
    productPicker,
    selectedParentProductVariantsQuery,
  } = useNewOrderLookupData({
    customerSearch: customerDraft.customerSearch,
    productSearch,
    selectedParentProduct,
  });
  const {
    error: productsError,
    fetchNextPage: fetchMoreProducts,
    hasNextPage: hasMoreProducts,
    isFetchingNextPage: isFetchingMoreProducts,
    isLoading: isProductsLoading,
    products: filteredProducts,
    refetch: refetchProducts,
  } = productPicker;
  const {
    data: selectedParentProductVariantsData,
    error: selectedParentProductError,
    isLoading: isLoadingSelectedParentProduct,
    refetch: refetchSelectedParentProduct,
  } = selectedParentProductVariantsQuery;
  const { defaultBranchId } = useOrderBranchSelection({
    enabled: autoSelectDefaultBranch,
    branches,
    scope,
    setSelectedBranchId,
  });
  const [sameAsCustomer, setSameAsCustomer] = useState(true);
  const [deliveryInfo, setDeliveryInfo] = useState(createEmptyDeliveryInfo);
  const [customItem, setCustomItem] = useState(createEmptyCustomItemDraft);
  const quickAddProductMatchState = useQuickAddProductMatches(customItem);
  const [partialAmount, setPartialAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const { calculatedVat, formatPrice, subtotal, taxesToUse, total, vatRate } =
    createNewOrderTotals({
      discount,
      isVatApplied,
      merchantCurrency: merchant?.payout_currency,
      merchantVatRate: merchant?.vat_rate,
      orderItems,
      shippingFee,
      taxes,
    });
  const isPickingVariant = selectedParentProduct !== null;
  const selectableProductRows = getSelectableProductRows({
    filteredProducts,
    isPickingVariant,
    selectedParentProductVariantsData,
  });
  const productActions = createNewOrderProductActions({
    customItem,
    orderItems,
    selectedParentProduct,
    setCustomItem,
    setOrderItems,
    setProductSearch,
    setSelectedParentProduct,
    setShowCustomItemModal: uiState.setShowCustomItemModal,
    setShowProductModal: uiState.setShowProductModal,
    setVariantReplacementItemId,
    variantReplacementItemId,
  });

  const customerActions = createNewOrderCustomerActions({
    createCustomer: createCustomerMutation.mutateAsync,
    merchantId: merchant?.id,
    newCustomer: customerDraft.newCustomer,
    onCustomerSelected: () =>
      setCustomerSelectionRevision((revision) => revision + 1),
    setCustomer,
    setCustomerSearch: customerDraft.setCustomerSearch,
    setDuplicateCustomer: customerDraft.setDuplicateCustomer,
    setIsCreatingCustomer: customerDraft.setIsCreatingCustomer,
    setNewCustomer: customerDraft.setNewCustomer,
    setSelectedCountryCode: customerDraft.setSelectedCountryCode,
    setShowCustomerModal: uiState.setShowCustomerModal,
  });
  const handleSubmit = () =>
    submitNewOrder({
      customer,
      deliveryInfo,
      discount,
      merchantCurrency: merchant?.payout_currency,
      merchantId: merchant?.id,
      notes,
      orderDate: date,
      orderItems,
      partialAmount,
      paymentMethod,
      paymentStatus,
      queryClient,
      sameAsCustomer,
      selectedChannel: selectedChannel ?? 'physical',
      selectedBranchId,
      setIsSubmitting,
      setLastOrderId: uiState.setLastOrderId,
      setShowSuccessModal: uiState.setShowSuccessModal,
      shippingFee,
      subtotal,
      submittingRef: isSubmittingRef,
      taxesToUse,
      total,
      userId: user?.id,
    });
  const resetOrderDraft = createResetOrderDraft({
    defaultBranchId,
    isVatRegistered,
    setCustomer,
    setDate,
    setDeliveryInfo,
    setDiscount,
    setIsVatApplied,
    setNotes,
    setOrderItems,
    setPartialAmount,
    setPaymentMethod,
    setPaymentStatus,
    setSameAsCustomer,
    setSelectedBranchId,
    setSelectedChannel,
    setShippingFee,
    setTaxes,
    setVariantReplacementItemId,
    uiState,
  });
  const handleChangeEditingItemVariant = createChangeEditingItemVariantHandler({
    setProductSearch,
    setSelectedParentProduct,
    setVariantReplacementItemId,
    uiState,
  });

  return {
    ...customerDraft,
    colors,
    createCustomerMutation,
    customer,
    customerSelectionRevision,
    customersData,
    customersQuery,
    customItem,
    date,
    deliveryInfo,
    discount,
    fetchMoreProducts,
    filteredProducts,
    hasMoreProducts,
    isFetchingMoreProducts,
    isLoadingSelectedParentProduct,
    isProductsLoading,
    isPickingVariant,
    isLoadingQuickAddProductMatches: quickAddProductMatchState.isLoading,
    isSubmitting,
    isVatApplied,
    merchant,
    notes,
    orderItems,
    partialAmount,
    paymentMethod,
    paymentStatus,
    productsError,
    productSearch,
    quickAddProductMatches: quickAddProductMatchState.matches,
    refetchProducts,
    refetchSelectedParentProduct,
    sameAsCustomer,
    selectableProductRows,
    branches,
    selectedChannel,
    selectedBranchId,
    selectedParentProduct,
    selectedParentProductError,
    ...uiState,
    setCustomer,
    setCustomItem,
    setDate,
    setDeliveryInfo,
    setDiscount,
    setIsVatApplied,
    setNotes,
    setOrderItems,
    setPartialAmount,
    setPaymentMethod,
    setPaymentStatus,
    setProductSearch,
    setSameAsCustomer,
    setSelectedChannel,
    setSelectedBranchId,
    setSelectedParentProduct,
    setShippingFee,
    setTaxes,
    shadows,
    shippingFee,
    subtotal,
    taxes,
    taxesToUse,
    total,
    vatRate,
    calculatedVat,
    formatPrice,
    handleSubmit,
    handleChangeEditingItemVariant,
    resetOrderDraft,
    ...customerActions,
    ...productActions,
  };
}

export type NewOrderController = ReturnType<typeof useNewOrderController>;
