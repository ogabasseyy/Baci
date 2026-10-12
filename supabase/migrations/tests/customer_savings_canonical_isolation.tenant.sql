CREATE FUNCTION pg_temp.insert_wrong_canonical_scope(p_goal uuid, p_draft uuid, p_merchant uuid,
  p_customer uuid, p_actor uuid, p_revision uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,variant_id,title,target_amount,
    status,source_mode,goal_kind,canonical_draft_id,canonical_draft_revision_id,canonical_actor_id)
    SELECT p_goal,p_merchant,p_customer,draft.product_id,draft.variant_id,draft.catalogue->>'name',
      COALESCE((draft.catalogue#>>'{variants,0,price_override}')::numeric,(draft.catalogue->>'price')::numeric),
      'paused','manual','canonical_local',draft.id,p_revision,p_actor
    FROM public.customer_savings_drafts draft WHERE draft.id=p_draft;
END $$;
SELECT revision_id AS actual_draft_revision FROM public.customer_savings_drafts WHERE id=:'draft' \gset
SET SESSION AUTHORIZATION savings_local_plan_writer;
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_wrong_canonical_scope(%L,%L,%L,%L,%L,%L)',
  :'second_canonical_goal', :'draft', :'merchant', :'customer', :'other_actor', :'actual_draft_revision'), '42501');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_wrong_canonical_scope(%L,%L,%L,%L,%L,%L)',
  :'second_canonical_goal', :'draft', :'merchant', 'ffffffff-ffff-4fff-8fff-ffffffffffff', :'actor', :'actual_draft_revision'), '42501');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_wrong_canonical_scope(%L,%L,%L,%L,%L,%L)',
  :'second_canonical_goal', :'draft', :'merchant', :'customer', :'actor', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT pg_temp.insert_canonical(%L,%L)', :'second_canonical_goal', :'unaccepted_draft'), '23514');
RESET SESSION AUTHORIZATION;
