import type { OrderPaymentAccountLike } from '@baci/shared';

type CreditOrderDvaAccount = OrderPaymentAccountLike & {
  account_name: string;
  bank_name: string;
};

export function toCreditOrderVirtualAccount(account: CreditOrderDvaAccount) {
  return {
    account_number: account.account_number,
    bank_name: account.bank_name,
    account_name: account.account_name,
  };
}
