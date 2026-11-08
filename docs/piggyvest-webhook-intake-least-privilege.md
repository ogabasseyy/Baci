# PiggyVest webhook intake: least-privilege database access

The receiver at `/api/webhooks/piggyvest` no longer uses the Supabase
service-role key. It connects to Postgres as the restricted login
`baci_piggyvest_webhook_intake`, over verified TLS, using the same connection
pattern as the primary-wallet evidence executor.

## What the login can do

- It is a member of the NOLOGIN group role `piggyvest_webhook_intake`.
- That group holds EXECUTE on the SECURITY DEFINER functions of the
  `piggyvest_webhook_intake` schema and nothing else: no table privilege, no
  other schema, no direct access to the existing capture or lease RPCs.
- The functions cover exactly what the receiver did before: durable capture
  (and inline completion to `processed` only), inbox record and lease, event
  quarantine, inflow and interest ledger writes, plan-wallet reads and status
  flips, outbox terminal states, plan-transfer allocation, and the staging
  wallet lookups.
- Migrations: `20261104140100_piggyvest_webhook_intake_role.sql` and
  `20261104140200_piggyvest_webhook_intake_table_functions.sql`. Contract test:
  `supabase/tests/piggyvest_webhook_intake_role.sql`.

## Behaviour that did not change

The signature is verified in the app before any write, the capture is durable
before the 200, and the status mapping documented at the top of `route.ts`
(200, 401, 503) is unchanged. When the login settings are missing or malformed
the receiver answers 503 with the capture-unavailable alert; it never falls
back to a broader credential.

## Settings (owner steps; never commit values)

- Already used by the primary-wallet logins and reused here:
  `PIGGYVEST_PRIMARY_DB_HOST`, `PIGGYVEST_PRIMARY_DB_PORT`,
  `PIGGYVEST_PRIMARY_DB_NAME`, `PIGGYVEST_PRIMARY_DB_CA`.
  On Vercel use the Supavisor session-mode pooler: host = pooler host, port
  `5432` (never `6543`), plus `PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF` = the
  project ref (login becomes `<login>.<ref>`). See
  `piggyvest-primary-runtime-deployment-follow-up.md`.
- New: `PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD`. The login name is fixed in code.
- Database: create the LOGIN role `baci_piggyvest_webhook_intake` with that
  password, then run `GRANT piggyvest_webhook_intake TO
  baci_piggyvest_webhook_intake;` (the migration does this itself only when the
  login already exists). Keep the login `NOSUPERUSER NOBYPASSRLS NOCREATEROLE
  NOCREATEDB NOREPLICATION`.

The capture drain (`webhook-capture-drain`) is not wired to a runtime in this
repository yet. It claims rows with lease tokens, which the intake group
deliberately cannot do; whoever wires it needs its own restricted authority.
