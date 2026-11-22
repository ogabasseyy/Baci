export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  quantity: number;
  price: number;
  condition?: string | null;
  variant_name?: string | null;
  image_url?: string;
  has_assurance?: boolean;
  assurance_fee?: number;
}

export interface OrderDetails {
  id: string;
  customer_id?: string | null;
  merchant_id?: string | null;
  order_number: string;
  shipping_status: string;
  subtotal: number;
  shipping_fee: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
  shipping_address: {
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
  };
  tracking_number?: string;
  shipping_provider?: string;
  notes?: string;
  items: OrderItem[];
}

export interface RawOrderItem {
  id: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  condition?: string | null;
  variant_name?: string | null;
  has_assurance?: boolean;
  assurance_fee?: number;
  products?:
    | { slug?: string; images?: string[] | null }
    | { slug?: string; images?: string[] | null }[]
    | null;
}

export type RawOrderDetails = Omit<OrderDetails, 'items'> & {
  order_items?: RawOrderItem[] | null;
};
