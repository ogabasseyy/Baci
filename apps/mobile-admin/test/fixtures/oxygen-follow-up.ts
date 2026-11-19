import type { FailedOrder } from '@/hooks/useFailedOrders';

export const oxygenProcessingOrder: FailedOrder = {
  id: 'oxygen-1',
  order_number: 'ORD-1',
  customer_id: 'customer-1',
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: '',
  total: 10000,
  payment_status: 'unpaid',
  payment_method: 'oxygen',
  created_at: '2026-11-17T08:00:00Z',
  attempt_count: 1,
  oxygen_follow_up_status: 'oxygen_processing',
};
