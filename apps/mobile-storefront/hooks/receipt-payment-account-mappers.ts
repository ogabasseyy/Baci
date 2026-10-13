interface CustomerPaymentAccountRpcRow {
  account_name: string | null;
  account_number: string;
  assigned_at: string | null;
  assignment_customer_email_source: string | null;
  bank_name: string | null;
  created_at: string | null;
  expires_at: string | null;
  provider: string | null;
}

export function mapCustomerPaymentAccountRpcRows(accountRows: unknown) {
  return ((accountRows as CustomerPaymentAccountRpcRow[] | null) ?? []).map(
    (account) => ({
      account_name: account.account_name,
      account_number: account.account_number,
      assigned_at: account.assigned_at,
      assignment_customer_email_source:
        account.assignment_customer_email_source,
      bank_name: account.bank_name,
      created_at: account.created_at,
      expires_at: account.expires_at,
      provider: account.provider,
    })
  );
}
