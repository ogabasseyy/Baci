# Domain lifecycle restricted writer

The Cloudflare for SaaS custom-domain onboarding, verification, activation,
reconciliation, and two-phase deletion flows persist provider-returned state
through six functions in `domain_lifecycle_private`:

- `domain_lifecycle_private.claim_due_domain_bindings(p_limit, p_lease_seconds)`
- `domain_lifecycle_private.record_domain_provider_result(...)`
- `domain_lifecycle_private.advance_domain_to_verifying_routing(p_domain_id, p_operation_id)`
- `domain_lifecycle_private.commit_domain_active(p_domain_id, p_operation_id)`
- `domain_lifecycle_private.withdraw_domain_verifying_routing(p_domain_id, p_operation_id)`
- `domain_lifecycle_private.finalize_domain_deletion(p_domain_id, p_operation_id, p_operator_reconciled)`

These functions are executable only by the `baci_domain_lifecycle_writer`
NOLOGIN group role. That role has no direct table privileges. Direct merchant
`UPDATE` mutations on SaaS-bound `public.domains` rows are blocked by trigger.

## Hosted activation gate

This migration does not create a login password or enable Cloudflare for SaaS
onboarding in a hosted environment. Before activation, the database operator
must provision a dedicated login named `baci_domain_lifecycle_provisioner`,
grant it membership only in `baci_domain_lifecycle_writer`, and issue its
password through the approved secrets process. Do not reuse the Supabase
service-role key or a shared application database login.

Configure the web runtime only after verifying that credential and its network
path:

- `DOMAIN_LIFECYCLE_WRITER_ENABLED=true`
- `DOMAIN_LIFECYCLE_WRITER_DB_HOST`
- `DOMAIN_LIFECYCLE_WRITER_DB_PORT`
- `DOMAIN_LIFECYCLE_WRITER_DB_NAME`
- `DOMAIN_LIFECYCLE_WRITER_DB_PASSWORD`
- `DOMAIN_LIFECYCLE_WRITER_DB_CA`
- `CLOUDFLARE_SAAS_ZONE_ID`

The runtime verifies TLS certificate identity, login identity, role membership,
absence of direct table privileges, and `EXECUTE` access to all six lifecycle
RPCs before accepting SaaS domain reservations. Until those values are
configured and verified, Cloudflare for SaaS provisioning remains disabled and
legacy Vercel domain operations remain unaffected.

Before enabling in production, run
`supabase/tests/domain_lifecycle_restricted_writer.sql` against the
chronological migration replay.
