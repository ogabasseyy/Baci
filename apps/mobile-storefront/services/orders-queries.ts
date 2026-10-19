import NetInfo from '@react-native-community/netinfo';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { OrderError } from './orders.errors';
import type { OrderResponse } from './orders.schemas';

const log = createLogger('Order');

async function checkNetwork(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected === true && state.isInternetReachable !== false;
}

export async function getOrder(
  orderId: string,
  customerId: string
): Promise<OrderResponse['order'] | null> {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    throw new OrderError(
      'No internet connection. Please check your network.',
      'NETWORK_ERROR'
    );
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, shipping_status, created_at'
    )
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .single();

  if (error) {
    log.error('Error fetching order', error);
    return null;
  }

  return data;
}

export async function getCustomerOrders(
  customerId: string,
  merchantId: string
) {
  const isOnline = await checkNetwork();
  if (!isOnline) {
    throw new OrderError(
      'No internet connection. Please check your network.',
      'NETWORK_ERROR'
    );
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, total, payment_status, shipping_status, created_at, order_items(id, product_id, condition, image_url, name, quantity, price, has_assurance)'
    )
    .eq('customer_id', customerId)
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (error) {
    log.error('Error fetching customer orders', error);
    throw new OrderError('Failed to load orders', 'FETCH_ERROR', error);
  }

  return data || [];
}
