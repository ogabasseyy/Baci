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
}
