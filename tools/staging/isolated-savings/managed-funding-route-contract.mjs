export function fundingRouteContract() {
  return [
    { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
    { path: '/rest/v1/rpc/get_storefront_product_variants', methods: ['POST'] },
    { path: '/rest/v1/customer_savings_goals', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/rpc/get_merchant_paystack_subaccount_code', methods: ['POST'] },
    { path: '/rest/v1/rpc/get_customer_savings_feature_settings', methods: ['POST'] },
    { path: '/rest/v1/rpc/create_customer_savings_goal', methods: ['POST'] },
  ];
}
