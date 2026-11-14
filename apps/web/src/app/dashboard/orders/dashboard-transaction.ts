export interface Transaction {
  id: string;
  reference?: string;
  gateway_reference?: string;
  /** Ledger row kind (payment/refund); present on order-details reads. */
  transaction_type?: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  created_at: string;
  /** Refund rows only: the payment leg this refund covers. */
  payment_transaction_id?: string | null;
  /** Refund rows: provider verdict stamp and stored provider refund id. */
  provider_refund_status?: string | null;
  provider_refund_id?: string | null;
  refund_method?: string | null;
}
