export interface DataCustomer {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface DataFormSuccessResult {
  reference: string;
  amount: number;
  customerIdentifier?: string;
  status?: 'processing' | 'successful';
  voucherPin?: string;
  cashback?: { amount: number; newBalance: number };
}
