import {
  buildCustomerRecordNameFields,
  CUSTOMER_ADMIN_COLUMNS,
} from '@baci/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchCustomerStats, fetchCustomers } from './customers-data';
import { useMerchant } from './useMerchant';

export type { Customer } from './customers-data';
export { useCreateCustomer } from './useCreateCustomer';

export function useCustomers(filters?: {
  customerType?: 'individual' | 'company';
  search?: string;
  sortBy?: 'recent' | 'orders' | 'spent' | 'alpha';
}) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;

  return useInfiniteQuery({
    queryKey: ['customers', merchantId, filters],
    queryFn: ({ pageParam = 0 }) => {
      if (!merchantId) throw new Error('No merchant selected');
      return fetchCustomers(merchantId, pageParam, filters);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    enabled: !!merchantId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

export function useCustomer(customerId: string) {
  const { merchant } = useMerchant();
  const merchantId = merchant?.id;

  return useQuery({
    queryKey: ['customer', customerId, merchantId],
    queryFn: async () => {
      if (!merchantId) throw new Error('No merchant selected');

      const [customerRes, ordersRes] = await Promise.all([
        supabase
          .from('customers')
          .select(CUSTOMER_ADMIN_COLUMNS)
          .eq('id', customerId)
          .eq('merchant_id', merchantId)
          .single(),
        supabase
          .from('orders')
          .select('id, order_number, total, shipping_status, created_at')
          .eq('merchant_id', merchantId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (customerRes.error) throw new Error(customerRes.error.message);
      if (ordersRes.error) throw new Error(ordersRes.error.message);

      return {
        ...customerRes.data,
        recent_orders: ordersRes.data ?? [],
      };
    },
    enabled: !!customerId && !!merchantId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

export function useCustomerStats() {
  const { merchant } = useMerchant();

  return useQuery({
    queryKey: ['customer-stats', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('No merchant selected');
      return fetchCustomerStats(merchant.id);
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUpdateCustomer() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['updateCustomer'],
    mutationFn: async (updates: {
      id: string;
      customer_type: 'individual' | 'company' | null;
      company_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      email: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      zip_code?: string | null;
      country?: string | null;
      country_code?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }) => {
      if (!merchant?.id) throw new Error('No merchant selected');

      const {
        id,
        address,
        city,
        state,
        zip_code,
        country,
        country_code,
        latitude,
        longitude,
        ...customerData
      } = updates;
      // Company-aware: recompute company_name/customer_type/full_name together so
      // a company customer's name can be edited on mobile too (mirrors the web
      // PATCH route). Callers must pass the stored customer_type so an untouched
      // company isn't flipped to individual.
      const nameFields = buildCustomerRecordNameFields(customerData);

      let localityPatch: Record<string, string | number | null> = {};
      if (address !== undefined) {
        const { data: existing, error: existingError } = await supabase
          .from('customers')
          .select(
            'address, city, state, zip_code, country, country_code, latitude, longitude'
          )
          .eq('id', id)
          .eq('merchant_id', merchant.id)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);

        const addressChanged =
          (existing?.address ?? null) !== (address ?? null);
        const hasStructuredLocality =
          city !== undefined ||
          state !== undefined ||
          zip_code !== undefined ||
          country !== undefined ||
          country_code !== undefined ||
          latitude !== undefined ||
          longitude !== undefined;

        if (addressChanged && !hasStructuredLocality) {
          // Freeform address edits invalidate prior geocoding/locality.
          localityPatch = {
            address,
            city: null,
            state: null,
            zip_code: null,
            country: null,
            country_code: null,
            latitude: null,
            longitude: null,
          };
        } else {
          localityPatch = {
            address,
            ...(city !== undefined ? { city } : {}),
            ...(state !== undefined ? { state } : {}),
            ...(zip_code !== undefined ? { zip_code } : {}),
            ...(country !== undefined ? { country } : {}),
            ...(country_code !== undefined ? { country_code } : {}),
            ...(latitude !== undefined ? { latitude } : {}),
            ...(longitude !== undefined ? { longitude } : {}),
          };
        }
      }

      const { data, error } = await supabase
        .from('customers')
        .update({
          ...customerData,
          ...nameFields,
          ...localityPatch,
        })
        .eq('id', id)
        .eq('merchant_id', merchant.id)
        .select(CUSTOMER_ADMIN_COLUMNS)
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
    },
  });
}

export function useDeleteCustomer() {
  const { merchant } = useMerchant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['deleteCustomer'],
    mutationFn: async (customerId: string) => {
      if (!merchant?.id) throw new Error('No merchant selected');

      // Check if customer has orders
      const { count: orderCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchant.id)
        .eq('customer_id', customerId);

      // Soft delete by setting deleted_at timestamp
      const { error } = await supabase
        .from('customers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', customerId)
        .eq('merchant_id', merchant.id);

      if (error) throw new Error(error.message);

      return {
        success: true,
        hadOrders: (orderCount ?? 0) > 0,
        orderCount: orderCount ?? 0,
      };
    },
    onSuccess: (_, customerId) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
    },
  });
}
