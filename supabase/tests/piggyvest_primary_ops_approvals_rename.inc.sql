-- Part of piggyvest_primary_ops_approvals.sql (\ir): a renamed login is not a
-- new human. A request remembers the requester's human_id, not only a login
-- name, so renaming the requester's login after it opened a request does
-- not let that login approve it. The registration belongs to the login's
-- name, so the renamed login first has none; and once the owner records the
-- new name under the same human it is still the requester's human.

SELECT t.id AS req50 FROM dblink('pvops_a',
  $q$SELECT pvops_test.open_as_session('0a0e0000-0000-4000-8000-000000000050')::text$q$)
  AS t(id uuid) \gset
SELECT pg_temp.pvops_digest(:'req50') AS dig50 \gset
ALTER ROLE pvops_test_approver_a RENAME TO pvops_test_approver_a_renamed;
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req50', 'approve', 250000, :'dig50'),
  'ops_approval_unregistered_login', 'requester login renamed, not registered again');
UPDATE piggyvest_primary.ops_login_humans SET login = 'pvops_test_approver_a_renamed'
WHERE login = 'pvops_test_approver_a';
SELECT pg_temp.pvops_expect(
  pg_temp.pvops_decide('pvops_a', :'req50', 'approve', 250000, :'dig50'),
  'ops_approval_requester_cannot_approve', 'requester login renamed and registered again');
SELECT pg_temp.pvops_assert(NOT EXISTS (
    SELECT 1 FROM piggyvest_primary.ops_approvals a WHERE a.request_id = :'req50'),
  'a renamed requester login must not leave a decision behind');
ALTER ROLE pvops_test_approver_a_renamed RENAME TO pvops_test_approver_a;
UPDATE piggyvest_primary.ops_login_humans SET login = 'pvops_test_approver_a'
WHERE login = 'pvops_test_approver_a_renamed';
