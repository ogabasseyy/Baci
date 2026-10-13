// Keep the order-notification outbox migration binding and its neighboring
// migration group separate so the complete manifest binding remains compact.
export const ORDER_NOTIFICATION_OUTBOX_PENDING_SOURCES = [
  {
    repositoryPath:
      'supabase/migrations/20260723150000_merchant_payment_secret_rpcs.sql',
    sha256: '36b7e8bb66b30691e633e312c8dbfea3bfee10a945007a59f0bfb8f5599991fe',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723160000_admin_merchant_profiles_rpc.sql',
    sha256: '28db4728fe8661bcd8083fa9bbd93b63a04c279c657b7f228d0c39cfca685e0a',
  },
  {
    repositoryPath:
      'supabase/migrations/20260723210000_scope_subaccount_rpc_staff_permission.sql',
    sha256: '9df49e0051a16c29e444513ad5bc2786c2420560071da5f02d8f249fc38616d0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724000001_deep_merge_get_staff_permissions.sql',
    sha256: 'b4fbc631b272f314b2c15f47f8bb59b3bbdea5583b620153a67f3915bf321918',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724000002_reject_staff_merchant_credential_writes.sql',
    sha256: '5b48e521ddc688c4694394c2c1f1c30ab01266951d3681f5d56cd2d6488c5ca0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724090000_s1_pr2b_revoke_payment_secret_column_grants.sql',
    sha256: '2a8e2b69b99fb69c2cbed3bd43f55218f15919951103163e525f0d87f696ed1d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724100000_s2i_contain_credit_direct_public_mutation.sql',
    sha256: 'a0f4d9cbfb59bb5df9d9a658bbe21e3f1753cad20532acf87aa4b5e784df66c5',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724100100_s2p_credit_direct_checkout_tokens.sql',
    sha256: 'e1ac8338dd870606df93984f8193d71b4ef66b72a2ef4440710a3ffcd9c4bea6',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724100200_s2p_harden_set_credit_direct_session.sql',
    sha256: 'cb454256cc5497a2073a38f85bf9ab5c7cc8f317a4779765829d793787c1e6a0',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724120000_order_scoped_receipt_bank_details_rpc.sql',
    sha256: 'd94773042e415b149f6c66615aaf2a668af386c6a529e324f7cc2287cdcbb5f2',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724130000_add_customers_date_of_birth.sql',
    sha256: 'aaa12834a752011d2c417f3f7b2e3ff7a1efdec7e58e265a898ceea0a3bc7b5d',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724140000_merchant_balance_gateway_origin_guard.sql',
    sha256: '8b794c4535b8a5f2acf674fbeb78037aeb518591e03b72bd2106efa4454e63f4',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724150000_set_customer_date_of_birth_rpc.sql',
    sha256: '77755c5f154ca7ccef73b2e0a2e68f9a5cf4cc9f1284a6489bb6d16d1c18d999',
  },
  {
    repositoryPath:
      'supabase/migrations/20260724153014_revoke_order_notification_outbox_claim_public_grants.sql',
    sha256: 'e134f42fa59b595a9df9479572a9ddb862efd7a834ad62de091e39d8b55c1074',
  },
] as const;
