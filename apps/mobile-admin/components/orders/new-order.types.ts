import type { VariantAttributes } from '@baci/shared';
import type { Customer } from '@/hooks/useCustomers';
import type { SelectableManualOrderProduct } from '@/lib/manual-order-line-item';
import type { CustomerType } from './new-order.shared';

export interface ShippingAddress {
  name: string;
  phone: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export type ProductMatchStatus = 'custom' | 'linked' | 'unreviewed';

export interface OrderItem {
  id: string;
  product_id: string | null;
  product_match_status?: ProductMatchStatus;
  name: string;
  quantity: number;
  price: number;
  condition?: string;
  image_url?: string;
  details?: string;
  is_custom?: boolean;
  variant_id: string | null;
  variant_attributes?: VariantAttributes | null;
  variant_name: string | null;
}

export interface CustomerInfo {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface DeliveryInfo {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface NewCustomerDraft {
  customerType: CustomerType;
  companyName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface CustomItemDraft {
  name: string;
  price: string;
}

export interface FinancialModalState {
  type: 'discount' | 'shipping' | 'tax';
  visible: boolean;
}

export type SelectableCustomer = Pick<
  Customer,
  | 'id'
  | 'customer_type'
  | 'company_name'
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'address'
> & {
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SelectableOrderProduct = SelectableManualOrderProduct;

export type SelectedParentProduct = SelectableOrderProduct | null;
