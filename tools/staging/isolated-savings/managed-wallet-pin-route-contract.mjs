import { fundingRouteContract } from './managed-funding-route-contract.mjs';

const approvedRoutes = [
  ...[
    'piggyvest_plan_wallets',
    'piggyvest_interest_payouts',
    'customer_wallets',
    'customer_wallet_transactions',
    'customer_wallet_payment_accounts',
    'customer_wallet_accounts',
  ].map((name) => ({ path: `/rest/v1/${name}`, methods: ['GET', 'HEAD'] })),
  ...[
    'get_storefront_payment_settings',
    'get_customer_savings_earnings',
    'get_customer_savings_notifications',
    'update_customer_savings_notification_preferences',
    'mark_customer_savings_notification_read',
    'register_push_token',
  ].map((name) => ({ path: `/rest/v1/rpc/${name}`, methods: ['POST'] })),
  { path: '/rest/v1/push_tokens', methods: ['PATCH'] },
  ...[
    'allocate_customer_savings_contribution',
    'set_customer_wallet_phone',
    'set_customer_wallet_profile',
    'get_wallet_pin_state',
    'set_wallet_pin',
    'change_wallet_pin',
    'reset_wallet_pin',
    'verify_wallet_pin',
  ].map((name) => ({ path: `/rest/v1/rpc/${name}`, methods: ['POST'] })),
];

export function walletPinRouteContract() {
  return [
    ...fundingRouteContract(),
    ...approvedRoutes.map(({ path, methods }) => ({
      path,
      methods: [...methods],
    })),
  ];
}
