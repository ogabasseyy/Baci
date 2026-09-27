import { vi } from 'vitest';
import { createOrderDetailsStatusActions } from './createOrderDetailsStatusActions';

type ActionsParams = Parameters<typeof createOrderDetailsStatusActions>[0];

export function createPaidOrderStatusActions(overrides?: {
  setSuccessModal?: ActionsParams['setSuccessModal'];
  updateStatus?: ActionsParams['updateStatus'];
}) {
  const setSuccessModal = overrides?.setSuccessModal ?? vi.fn();
  const updateStatus =
    overrides?.updateStatus ?? vi.fn().mockResolvedValue(undefined);
  const actions = createOrderDetailsStatusActions({
    openShipmentFlow: vi.fn(),
    order: {
      id: 'order-paid',
      amount_paid: 5000,
      balance: 0,
      created_at: '',
      customer_email: 'customer@example.com',
      customer_name: 'Ada',
      customer_phone: null,
      discount_amount: 0,
      is_credit_order: false,
      order_number: 'ORD-PAID',
      payment_status: 'paid',
      shipping_address: null,
      shipping_status: 'processing',
      total: 5000,
      updated_at: '',
    },
    setShowCreditModal: vi.fn(),
    setShowPaymentOptionModal: vi.fn(),
    setShowStatusModal: vi.fn(),
    setSuccessModal,
    updateStatus,
  });
  return { actions, setSuccessModal, updateStatus };
}
