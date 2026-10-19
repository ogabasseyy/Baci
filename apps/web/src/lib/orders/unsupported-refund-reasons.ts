import type { GatewayPaymentTransaction } from './gateway-payment-transaction';

export function unsupportedRefundReasons(
  transactions: GatewayPaymentTransaction[]
): string[] {
  return [
    ...new Set(
      transactions.map((transaction) => {
        if (!transaction.gateway) return 'missing gateway';
        if (!transaction.gateway_reference) {
          return `${transaction.gateway} missing reference`;
        }
        return transaction.gateway;
      })
    ),
  ];
}
