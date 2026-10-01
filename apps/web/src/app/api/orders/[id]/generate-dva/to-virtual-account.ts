type PaymentAccount = {
  account_name: string;
  account_number: string;
  bank_name: string;
};

export function toVirtualAccount(account: PaymentAccount) {
  return {
    account_name: account.account_name,
    account_number: account.account_number,
    bank_name: account.bank_name,
  };
}
