import type { ReceiptOrder } from '@baci/shared';
import type { OrderConfirmationData } from '@/lib/email-templates';
import type { InvoiceData } from '@/lib/invoice-generator';
import type { createClient } from '@/lib/supabase/server';
import type { OrderCreateInput } from '@/schemas/orders';

/**
 * Order row shape the immediate-notification lifecycle reads. The
 * create-RPC row carries no currency column, so callers stamp the
 * currency explicitly alongside it.
 */
export interface ImmediateNotificationOrder {
  id: string;
  tracking_token?: string | null;
  amount_paid?: number | string | null;
  payment_status?: string | null;
  created_at?: string | null;
  total?: number | string | null;
  tax_amount?: number | string | null;
  discount_amount?: number | string | null;
  is_credit_order?: unknown;
  firs_irn?: unknown;
  firs_csid?: unknown;
  currency?: unknown;
  fulfillment_details?: unknown;
  [key: string]: unknown;
}

export interface ImmediateNotificationMerchant {
  business_name: string;
  slug: string;
  phone?: string | null;
  email?: string | null;
  support_email?: string | null;
  email_sender_name?: string | null;
  tax_identification_number?: string | null;
  cac_rc_number?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_name?: string | null;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  registered_address?: InvoiceData['merchant']['registered_address'] | null;
  support_phone?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}

export interface ResolvedImmediateOrderEmail {
  documentKind: 'confirmation' | 'proforma' | 'payment_request';
  isPaidForEmail: boolean;
  subject: string;
}

export interface ImmediateOrderNotificationContext {
  supabase: ReturnType<typeof createClient>;
  order: ImmediateNotificationOrder;
  orderNum: string;
  merchant: ImmediateNotificationMerchant;
  merchantId: string;
  customerId?: string | null;
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  effectivePaymentMethod: string;
  /** Request payment_status (pre-coverage); the order row may differ. */
  paymentStatus?: string | null;
  orderTotal: number;
  orderSubtotal: number;
  orderShippingFee: number;
  orderCurrency: string;
  amountDueToGateway: number;
  savingsAmountUsed: number;
  walletAmountUsed: number;
  isWalletFullyPaid: boolean;
  isQuizVoucherFullyPaid: boolean;
  idempotencyReplayed: boolean;
  emailData: OrderConfirmationData;
  immediateEmail: ResolvedImmediateOrderEmail;
  replyToEmail: string;
  senderName?: string;
  paymentLink: string;
  /**
   * Tracking token minted at creation: the proof for the proof-bound
   * invoice-artifact RPCs (never an admin client, AGENTS.md).
   */
  trackingToken: string | null;
  notes?: string;
  shippingAddress: OrderCreateInput['shipping_address'];
}

export interface PreResponsePayformeProvisioning {
  virtualAccount: ReceiptOrder['virtual_account'];
  attempted: boolean;
}

export interface ImmediateInvoiceArtifacts {
  attachments:
    | Array<{ name: string; content: string; mime_type: string }>
    | undefined;
  emailedInvoiceTypeCode: string | undefined;
  invoiceVirtualAccount: ReceiptOrder['virtual_account'];
}

export interface ImmediateEmailSendInput {
  attachments:
    | Array<{ name: string; content: string; mime_type: string }>
    | undefined;
  invoiceVirtualAccount: ReceiptOrder['virtual_account'];
}

export interface MerchantOrderNotificationContext {
  supabase: ReturnType<typeof createClient>;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderTotal: number;
  orderCurrency: string;
  paymentMethod: string;
  paymentStatus?: string | null;
  invoiceBalanceDue: number;
  isWalletFullyPaid: boolean;
}
