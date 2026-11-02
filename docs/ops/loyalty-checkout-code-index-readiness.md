# Loyalty checkout index readiness (#3689)

The replay fix is independent of the historical `loyalty_redemption_checkout_code_idx` deployment prerequisite. Migration `20261010000009_loyalty_checkout_bridge.sql` creates a unique index on merchant and uppercase code without reminting historical duplicates. A later migration cannot repair a database blocked while applying that earlier migration. Existing migrations remain immutable.

Before qualifying a target database, an authorized operator must confirm both that the index exists and is valid/unique, and that its deployed definition matches the merchant-scoped uppercase-code key. This read-only inventory returns index status and the count of duplicate groups without exposing codes or customer data:

```sql
SELECT index_row.indisvalid, index_row.indisunique,
       pg_catalog.pg_get_indexdef(index_row.indexrelid) AS definition
FROM pg_catalog.pg_index index_row
WHERE index_row.indexrelid = pg_catalog.to_regclass('public.loyalty_redemption_checkout_code_idx');

SELECT count(*) AS duplicate_code_groups
FROM (
  SELECT merchant_id, upper(discount_code)
  FROM public.reward_redemptions
  WHERE discount_code IS NOT NULL
  GROUP BY merchant_id, upper(discount_code)
  HAVING count(*) > 1
) duplicates;
```

A missing, invalid, or differently defined index is not deployment-ready. If legacy duplicate groups exist, do not silently delete or remint paid customer codes. Preserve redemption ownership, usage/expiry snapshots and an auditable old-to-new mapping in a separately reviewed repair before attempting the historical index. No repair or production query is performed by this document or the replay migration.

Keep #3689 open for this deployment-readiness portion until target-specific evidence or an approved repair resolves it. A clean synthetic SQL replay does not establish the contents of an existing database.
