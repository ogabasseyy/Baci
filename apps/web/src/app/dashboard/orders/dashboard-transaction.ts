export interface Transaction {
  id: string;
  reference?: string;
  gateway_reference?: string;
  status: string;
  amount: number;
  currency: string;
  gateway: string;
  created_at: string;
}
