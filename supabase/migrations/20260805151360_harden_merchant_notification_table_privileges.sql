-- Remove inherited table-wide capabilities that bypass column-scoped recipient
-- state updates. RLS does not protect TRUNCATE and does not constrain columns.

BEGIN;

REVOKE ALL ON TABLE public.merchant_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.merchant_notifications TO authenticated;
GRANT UPDATE (read_at, dismissed_at, banner_dismissed_at)
  ON TABLE public.merchant_notifications TO authenticated;

COMMIT;
