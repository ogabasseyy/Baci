import type { ShippingQuote } from '@/types/shipping-quote';

export interface SavedAddress {
  id: number;
  label: string;
  address: string;
  phone: string;
  isDefault: boolean;
}

export interface ShippingLocation {
  city: string;
  state: string;
}

export type { ShippingQuote };

export interface QuoteResponse {
  quotes: {
    featured: ShippingQuote[];
    all: ShippingQuote[];
  };
  sessionId: string;
}

export interface CryptoPaymentData {
  address: string;
  chain: string;
  currency: string;
  amount: number;
  confirmation_time: string;
  orderId: string;
  reference: string;
  sessionId: string;
  paymentId: string;
  qrcode?: string;
  trackingToken?: string;
}

export interface DvaData {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  amount: number;
  reference: string;
}

export interface PendingCryptoOrder {
  orderId: string;
  amount: number;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  billingAddress: {
    line1: string;
    city: string;
    state: string;
    country: string;
    zip_code?: string;
  };
  items: Array<{ name: string; type: 'physical' | 'digital' }>;
  trackingToken?: string;
}

export interface ResumedOrder {
  tax_amount?: number;
  discount_amount?: number;
  gift_wrapping_fee?: number;
  id: string;
  short_id: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  tracking_token?: string;
  shipping_address: {
    address: string;
    city: string;
    state: string;
    phone: string;
  };
  items: Array<{
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    price: number;
    image_url?: string;
  }>;
}

export type CryptoChain = 'TRX' | 'ETH' | 'MATIC' | 'AVAXC';
export type CryptoCurrency = 'USDT' | 'USDC';
export type CryptoVerificationStatus = 'idle' | 'checking' | 'confirmed' | 'pending' | 'failed';

export type DeliveryMethod = 'pickup' | 'door' | 'airport' | 'pickup_station';
export type CheckoutStep = 'contact' | 'delivery' | 'payment';
export type PaymentMethod =
  | 'paystack'
  | 'korapay'
  | 'juicyway'
  | 'credpal'
  | 'credit_direct'
  | 'klump'
  | 'invoice'
  | 'payforme'
  | 'pod'
  | 'bank_transfer'
  | 'paypal'
  | '';
export type PaymentTab = 'full' | 'installments';
