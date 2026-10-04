# ADR 003: Connector Gateway Database Access (C-prime)

Date: 2 October 2026. Status: **Accepted for the isolated R0 proof and
read-only staging pilot**, under the owner's delegated authorization on
this date; scope expires on 9 October 2026. See
[`muse-r0-authorization.md`](../connectors/muse-r0-authorization.md).
The R0 harness is the only consumer. Full-schema branch proof is complete;
production authorization remains pending the real Muse pilot and a
production-scope decision. On 3 October 2026 the owner accepted C-prime
for read-only R1 implementation and isolated staging validation under the
same role, transaction, and claim shape; production deployment stays gated
on the production-scope decision and pilot evidence.

## Context

Repository rules require user-facing operations to use the normal
Supabase server/browser client under RLS, with no service-role clients
and no parallel authorization system. Connector calls arrive with an
opaque connector token, not a Supabase user JWT, so the normal client
cannot establish the linked user's RLS context. Alternatives evaluated
in `docs/connectors/muse-r0-design.md` §5:

- Short-lived user JWT exchange: requires a service-role exception
  (none valid; all legacy exceptions expired 2026-09-16).
- Row-returning SECURITY DEFINER RPCs per tool: bypass RLS inside the
  RPC body and replicate policy logic (rejected as a parallel system).
- In-RPC `SET ROLE` impersonation: invalid — PostgreSQL forbids it
  (observed: `cannot set parameter "role" within security-definer
  function`).

## Decision (accepted within the R0 scope)

Adopt C-prime: the gateway connects over a direct pooled connection as a
least-privilege `connector_gateway` role. Each call runs one audited
transaction: validate the token via `resolve_connector_grant_context`,
then `SET LOCAL ROLE authenticated` plus linked-user jwt claims, then
issue the tool's normal scoped reads. All rows flow through the existing
RLS policies as the linked user.

## Reconciliation with the normal-client rule

C-prime preserves the rule's intent (RLS enforcement, no privilege, no
parallel authorization) while changing the transport:

| Requirement | C-prime treatment |
|---|---|
| Role attributes | `connector_gateway`: `NOLOGIN` at rest (provisioning grants `LOGIN` with a vaulted secret for the runtime only), member of `authenticated` (required for `SET ROLE`), `EXECUTE` on `resolve_connector_grant_context` and `rotate_connector_grant_tokens` only. Inherits `authenticated` table grants via membership; RLS — not table privilege — is the enforcement point. |
| Accessible tables/functions | Resolve/rotate RPCs plus whatever `authenticated` can already read; every row additionally filtered by RLS under the linked-user claims. No bypass, no `BYPASSRLS`, no ownership of application tables. |
| Fixed tool→scope mapping | Scope allowlist, resource/action allowlist, and scope↔resource correspondence are enforced inside `resolve_connector_grant_context`; the manifest is the single source of tool scopes and the gateway passes them through without interpretation. |
| Claim provenance | Resolve sets transaction-local identity from the validated grant row before checking live permissions. The gateway uses the returned linked `user_id` from the same transaction for RLS reads; missing claims fail closed (zero rows, proved). Caller-supplied identity is never accepted. |
| Transaction/pool cleanup | One transaction per call (`BEGIN` … `COMMIT`/`ROLLBACK`); `SET LOCAL` bounds role and claims to that transaction, so pooled connections cannot leak identity. Pool size is fixed and small (5 in the harness). |
| Full-schema RLS evidence | Full-schema confirmation is complete: snapshot restore, parent/branch comparison, connector migration, SQL regressions, direct-RLS/gateway equivalence and 16/16 hosted harness checks. The production session guard exposed a resolver defect, fixed with branch and suite red-green controls. See the [branch proof](../connectors/muse-r0-branch-proof.md) for results, explained schema deltas and cleanup. |

## Consequences

- The isolated R0 harness and private read-only staging pilot may use
  this design during the authorization window. Read-only R1
  implementation and isolated staging validation are accepted as of
  3 October 2026. R1 production deployment still requires completion of
  the real Muse pilot and an explicit production-scope decision; this
  acceptance does not open production.
- If rejected, the fallback is the JWT-exchange edge, which needs its own
  service-role exception and owner approval.
- C-prime remains confined to the authorized R0 harness against the
  isolated branch. No production route is authorized by this acceptance.

## Authorization granted

### Production read-only rollout approval — 3 October 2026

The owner approved a brief maintenance window, production connector migrations,
DNS/TLS configuration, and VPS deployment in this conversation (reply: "yh"),
and subsequently instructed "proceed". This extends C-prime approval to the
four read-only tools with owner-created, independently revocable merchant and
branch-scoped grants. It permits no store-data writes or financial operations.
Scheduling, automatic refresh, cross-device reuse, and write-approval receipts
remain unverified product capabilities and must not be claimed in the listing.
Review, migration validation, and public runtime verification remain required
before release. No deployment is implied by this approval record.

For the isolated R0 proof and read-only staging pilot only, scoped
approval for: (1) the `connector_gateway` role shape above;
(2) direct pooled connections from the connector runtime only;
(3) per-transaction `SET LOCAL` role/claims from validated resolve
output. Owner instruction: "authorise and decide for me", 2 October
2026. Production deployment and financial operations remain separately
gated regardless. Full scope, expiry, branch identity and transport
conditions are recorded in the linked authorization record.

## Runtime credential trust boundary

C-prime treats the gateway process and its database credential as trusted backend
infrastructure. Membership in `authenticated` permits that backend to establish
linked-user RLS identity; PostgreSQL does not independently bind those claims to
a connector grant. Consequently a compromised runtime database credential is
not confined to one connector grant or the four gateway tools. `NOBYPASSRLS`
and restricted HTTP routes do not remove that credential-compromise risk.

The production approval above selected this architecture, not a database-enforced
per-grant capability design. A narrower compromise boundary requires replacing
general authenticated-role membership with restricted database operations and
revalidating every data path. This release must describe the runtime as a trusted
backend and must not claim that its database credential is connector-scoped.
Individual merchant bearer credentials remain grant-scoped at the gateway.
