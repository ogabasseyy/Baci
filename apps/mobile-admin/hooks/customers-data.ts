import {
  buildCustomerSearchFilter,
  CUSTOMER_ADMIN_COLUMNS,
} from '@baci/shared';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';

export interface Customer {
  id: string;
  merchant_id: string;
  customer_type: 'individual' | 'company';
  company_name: string | null;
  full_name: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  total_orders: number;
  total_spent: number;
  store_credit: number;
  loyalty_points: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  deleted_at: string | null;
}

interface CustomersPage {
  customers: Customer[];
  nextCursor: number | null;
  totalCount: number;
}

const PAGE_SIZE = 20;

export async function fetchCustomers(
  merchantId: string,
  cursor: number = 0,
  filters?: {
    customerType?: 'individual' | 'company';
    search?: string;
    sortBy?: 'recent' | 'orders' | 'spent' | 'alpha';
  }
): Promise<CustomersPage> {
  let query = supabase
    .from('customers')
    .select(CUSTOMER_ADMIN_COLUMNS, { count: 'exact' })
    .eq('merchant_id', merchantId)
    .is('deleted_at', null);

  if (filters?.customerType) {
    query = query.eq('customer_type', filters.customerType);
  }

  if (filters?.search) {
    const term = sanitizeSearchQuery(filters.search);
    if (term) {
      query = query.or(buildCustomerSearchFilter(term));
    }
  }

  switch (filters?.sortBy) {
    case 'orders':
      query = query.order('total_orders', { ascending: false });
      break;
    case 'spent':
      query = query.order('total_spent', { ascending: false });
      break;
    case 'alpha':
      query = query
        .order('full_name', { ascending: true, nullsFirst: false })
        .order('first_name', { ascending: true, nullsFirst: false })
        .order('email', { ascending: true, nullsFirst: false })
        .order('phone', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  query = query.range(cursor, cursor + PAGE_SIZE - 1);

  const { data, error, count } = await query;

  if (error) throw new Error(error.message);

  const hasMore = (count ?? 0) > cursor + PAGE_SIZE;

  return {
    customers: data ?? [],
    nextCursor: hasMore ? cursor + PAGE_SIZE : null,
    totalCount: count ?? 0,
  };
}

export async function fetchCustomerStats(merchantId: string) {
  const now = new Date();
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();
  const startOfWeek = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const [totalRes, newThisMonthRes, newThisWeekRes, returningRes] =
    await Promise.all([
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId)
        .is('deleted_at', null),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId)
        .is('deleted_at', null)
        .gte('created_at', startOfMonth),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId)
        .is('deleted_at', null)
        .gte('created_at', startOfWeek),
      supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId)
        .is('deleted_at', null)
        .gt('total_orders', 1),
    ]);

  if (totalRes.error) throw new Error(totalRes.error.message);
  if (newThisMonthRes.error) throw new Error(newThisMonthRes.error.message);
  if (newThisWeekRes.error) throw new Error(newThisWeekRes.error.message);
  if (returningRes.error) throw new Error(returningRes.error.message);

  const { count: total } = totalRes;
  const { count: newThisMonth } = newThisMonthRes;
  const { count: newThisWeek } = newThisWeekRes;
  const { count: returning } = returningRes;

  return {
    newThisMonth: newThisMonth ?? 0,
    newThisWeek: newThisWeek ?? 0,
    retentionRate:
      total && total > 0 ? Math.round(((returning ?? 0) / total) * 100) : 0,
    returning: returning ?? 0,
    total: total ?? 0,
  };
}
