# Isolated first-card foundation installation

The initial owner diagnostic confirmed database system identifier
`7685292944002592802` with no prefunded schema, checkout functions, executor roles
or prefunded service. The existing gateway was not the missing payment backend.

The corrected installer has now completed. Its saved postflight was read from the
VPS on 27 September 2026 at 09:14 UTC: `foundation_installed_inactive`, nine
checkout functions, three executor roles, zero unsafe roles and zero operations,
treasury bindings or checkout intents. SQL SHA-256:
`1e8ec01bc0d2bafaa720373cbba1c87c426b087659d6f657117d8068776413be`.
No prefunded services were started and payments remain disabled. Do not rerun the
fresh-install-only package after this successful commit.

`foundation-install-reviewed.sh` is a persistent owner entrypoint. It refuses
until a reviewed `foundation.sql` and its checksum manifest have been packaged
and the manifest hash has been pinned in the launcher. It verifies immutable
captured manifest bytes, stages only SQL and the root runner, then verifies both
again in a new private root directory before execution. No temporary Mac wrapper
is needed. Root candidates are retained for diagnosis.

The SQL is assembled from exact checked source files by the canonical savings
worktree's `tools/staging/prefunded-card/foundation-install.py`. Test fixtures and
synthetic customer data are not deployment inputs. The assembly preserves one
transaction, verifies the physical database, fixed expiry and prerequisites,
and finalizes the executor roles as NOLOGIN before commit. A conflicting existing
installation refuses rather than being overwritten. Failures before commit roll
back the transaction; a client interruption or postflight failure must be inspected
before retrying because a commit may already have occurred.

The package contains 36 pinned SQL sources, including the bounded first-card
recovery reader. The complete assembly was rehearsed in disposable PostgreSQL
with synthetic prerequisite tables and stub canonical ledger functions. That is
DDL and refusal-path proof, not live prerequisite compatibility or financial E2E.
Existing executor roles are refused even if NOLOGIN, avoiding reuse of unknown
memberships. A scheduler and durable recovery cursor are not part of this package.

The first owner run refused before applying any source SQL because the preflight
incorrectly required `piggyvest_staging.integrations.merchant_id`. The canonical
registry migration defines a provider-account registry, not a merchant table.
The corrected package checks its actual `id`, `expected_provider_account_id` and
`enabled` columns. Merchant requirements on customers, goals, wallet mappings and
ledger bindings remain unchanged. No database column or migration was changed.
The rehearsal registry now matches the authoritative migration declaration, with
regressions observed failing before the preflight correction and passing after it.

The root runner uses only the fixed isolated database container and database name.
It suppresses raw database output and surfaces bounded foundation prerequisite
identifiers. It announces when the transaction has committed before running its
separate read-only metadata check. A successful result is
`foundation_installed_inactive`, not phone readiness.

This package does not provision passwords, seed or replenish treasury funds,
credit customers, start a worker, restart an application, edit Nginx or deploy
Vercel. The expiry remains `2026-09-29T15:59:10Z`. Production is not a target.

Remaining activation requires verified treasury and customer enrollment,
restricted credentials and database transport, background collection recovery,
PiggyVest transfer/evidence processing, and authenticated public routing tests.
The first-card feature must remain disabled until these pass together.

Local wrapper regressions:

```sh
python3 tools/staging/prefunded-card/foundation-owner.test.py
python3 tools/staging/prefunded-card/foundation-install-reviewed.test.py
```
