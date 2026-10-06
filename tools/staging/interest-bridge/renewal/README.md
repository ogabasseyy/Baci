# Inactive interest credential renewal

This owner action changes only the existing `prefunded_treasury_operator`
password-validity deadline from 29 September to 6 October 2026 at 15:59:10 UTC.
It preserves the password, all privileges and memberships, other role deadlines,
function definitions, plans, principal, treasury state, and retired checkout.
It grants no bridge access, creates no payout allocation, renews no JWT or
financial artifact, and starts no service. It is not full replay activation.

The exact application database identity, canonical goal/business binding,
installed bridge definition, zero interest receipts/allocations and inactive
financial runtimes are prerequisites. The SQL rehearses with rollback first;
only a separate explicit `--apply` commits. Secrets never appear in reports.
The complete protected-state comparison happens while holding database locks.

Stage the SQL and owner script as root-owned mode-0600 files in a root-private
0700 directory immediately below `/root`. Verify a sealed checksum list before
execution. Retain the independent rehearsal and committed result reports.
Do not retry an ambiguous apply; first read the actual role deadline and audit.

Financial activation still needs renewed scoped JWTs, a reviewed TLS transport,
deadline enforcement and a genuine independently mapped payout with an approved
allocation. No company-wallet payout may be credited to the customer's plan.

## Separate inactive runtime preparation

`interest_runtime_preparation.py` is a distinct preparation-only step, not the
expiry-only SQL action. It requires the already-renewed treasury login and the
exact sealed prepared credential source. It verifies all five financial
containers and four financial systemd services are stopped, then creates a
root-private candidate with fresh JWTs for the same restricted receipt/app roles,
the existing receipt encryption key and only the approved treasury TLS connection.
Its fixed deadline is 6 October 2026 at 15:59:10 UTC. It changes no database,
provider setting, live configuration, privilege, allocation or balance.

Use a fresh exclusive root directory for each attempt. A refused preparation may
retain a private configuration without a success receipt; retain that evidence
and do not reuse or activate it. The original financial configuration is not
renewed by this candidate, and no payment service is started.

Private Docker checks must preserve the reviewed TLS hostname binding
`piggyvest-db.staging.baci.internal:172.23.0.2`, after verifying the exact isolated
database container, network address and physical database identity. The hostname
must remain unchanged for certificate validation. No global DNS/network mutation
or plaintext connection fallback is authorized.

The candidate's `--check` reads both HTTP database identities, opens a restricted
TLS read-only transaction and inspects the exact paid bridge privilege. It never
invokes that bridge. `interest-authority` means transport and identities passed
but the separately approved paid execution grant is absent; `financial-database`
does not establish successful TLS. Neither outcome enables replay or crediting.
