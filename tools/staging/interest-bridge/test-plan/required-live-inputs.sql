BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT jsonb_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'database',current_database(),'sessionUser',session_user,'currentUser',current_user,
  'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'oldGoal',(SELECT jsonb_build_object('id',id,'merchantId',merchant_id,'customerId',customer_id,
    'productId',product_id,'variantId',variant_id,'principalKobo',current_amount*100,
    'goalKind',goal_kind,'sourceMode',source_mode,'status',status)
    FROM public.customer_savings_goals WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
  'catalogue',(SELECT jsonb_build_object('id',product.id,'status',product.status,'price',product.price,
    'name',product.name,'condition',product.condition,'images',product.images,
    'variants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',variant.id,'condition',variant.condition,
      'sku',variant.sku,'priceOverride',variant.price_override,'primaryImage',variant.primary_image,
      'images',variant.images,'attributes',variant.attributes,'inventoryAnchor',variant.is_inventory_anchor)
      ORDER BY variant.id),'[]'::jsonb) FROM public.product_variants variant
      WHERE variant.product_id=product.id AND variant.merchant_id=product.merchant_id))
    FROM public.products product JOIN public.customer_savings_goals goal ON goal.product_id=product.id
    WHERE goal.id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
  'ownerMatches',(SELECT merchant_id='10000000-0000-4000-8000-000000000001'::uuid
    AND user_id='baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'::uuid AND deleted_at IS NULL
    FROM public.customers WHERE id='10000000-0000-4000-8000-000000000002'),
  'actorActive',EXISTS(SELECT 1 FROM auth.users WHERE id='baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
    AND deleted_at IS NULL),
  'merchantPublished',(SELECT is_published FROM public.merchants
    WHERE id='10000000-0000-4000-8000-000000000001'),
  'savingsEnabled',(SELECT customer_device_savings_enabled FROM public.merchant_feature_settings
    WHERE merchant_id='10000000-0000-4000-8000-000000000001'),
  'oldBinding',(SELECT jsonb_build_object('integrationId',integration_id,'merchantId',merchant_id,
    'customerId',customer_id,'authorizedLogin',authorized_login,'enabled',enabled)
    FROM piggyvest_savings_ledger.bindings WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
  'candidateMappings',(SELECT coalesce(jsonb_agg(jsonb_build_object('goalId',goal_id,
    'integrationId',integration_id,'merchantId',merchant_id,'customerId',customer_id,
    'providerWalletId',provider_wallet_id,'providerCustomerId',provider_customer_id)),'[]'::jsonb)
    FROM piggyvest_staging.wallet_goal_mappings
    WHERE provider_wallet_id='01M3W0Y93XHJY9RPQ2G75X81WG'),
  'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'super',rolsuper,
    'bypassRls',rolbypassrls,'createDb',rolcreatedb,'createRole',rolcreaterole,
    'replication',rolreplication,'validUntil',rolvaliduntil)) FROM pg_roles
    WHERE rolname IN ('authenticated','prefunded_treasury_operator')),
  'routines',(SELECT jsonb_agg(jsonb_build_object('signature',routine.oid::regprocedure::text,
    'definitionMd5',md5(pg_get_functiondef(routine.oid)),'owner',routine.proowner,
    'securityDefiner',routine.prosecdef,'configuration',routine.proconfig,'acl',routine.proacl))
    FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
    WHERE namespace.nspname='public' AND routine.proname IN
      ('create_customer_savings_goal','get_customer_savings_feature_settings')),
  'goalTriggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,
    'definition',pg_get_triggerdef(oid))) FROM pg_trigger
    WHERE tgrelid='public.customer_savings_goals'::regclass AND NOT tgisinternal),
  'columns',(SELECT jsonb_agg(jsonb_build_object('table',attrelid::regclass::text,'name',attname,
    'type',format_type(atttypid,atttypmod),'notNull',attnotnull) ORDER BY attrelid,attnum)
    FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND attrelid IN (
      'public.product_variants'::regclass,'public.customer_savings_goals'::regclass,
      'piggyvest_savings_ledger.bindings'::regclass,'piggyvest_savings_ledger.interest_policies'::regclass))
);
ROLLBACK;
