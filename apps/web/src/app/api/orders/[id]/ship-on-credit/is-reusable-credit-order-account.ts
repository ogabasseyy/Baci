import {
  type OrderPaymentAccountLike,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';

export function isReusableCreditOrderAccount(account: OrderPaymentAccountLike) {
  return selectPreferredOrderPaymentAccount([account]) !== null;
}
