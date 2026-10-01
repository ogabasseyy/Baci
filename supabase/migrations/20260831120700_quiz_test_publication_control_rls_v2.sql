-- Harden the private test-publication gate with PostgreSQL row-level security.
-- No policies are intentionally defined: all non-owner table access remains
-- deny-by-default, while the postgres-owned SECURITY DEFINER guard can read it.

BEGIN;

ALTER TABLE private.quiz_test_publication_control_v2
  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.quiz_test_publication_control_v2 IS
  'Private singleton test-publication gate. RLS is enabled with no policies so non-owner access is denied by default.';

COMMIT;
