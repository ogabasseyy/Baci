# Baci × Muse Connector — R0 Technical Design

Status: Local R0 spike implemented; isolated R0/staging authorization granted;
Full-schema branch proof complete; R0 exit gate pending the real Muse
pilot. No production traffic. R1 production implementation stays
gated until production-scope ADR-003 is resolved and the pilot
connect/refresh/revoke/discovery proofs (or concrete blockers/fallbacks)
are recorded.

Source plan: `Baci Connector Plan.docx` (Hybrid architecture retained,
R0 ready; implementation gated, 1 October 2026).

## 1. Repository mapping (verified against code)

### 1.1 Authorization path (connector must reuse)

| Concern | Exact module / object |
|---|---|
| API authentication (Bearer mobile / cookie web) | `apps/web/src/lib/api-auth.ts` → `authenticateApiRequest`, returns RLS-safe scoped client |
| Merchant + staff resolution (RPC) | `apps/web/src/lib/api-auth.ts` → `getUserAccess` via `get_user_access` RPC, validated by `@/schemas/api-auth` `userAccessSchema` |
| Merchant + staff resolution (table) | `apps/web/src/lib/get-merchant-for-api-request.ts` → `getMerchantForApiRequest` (owner via `merchants.user_id`; staff via `staff_members` + `role_permissions` merged by `mergeStaffPermissions`) |
| Permission check | `apps/web/src/lib/api-permissions.ts` → `hasPermission(access, resource, action)` (owner bypass; staff via `permissionGrantsAccess`) |
| RLS membership check | `public.has_merchant_access(uuid)` (owner or active staff; baseline migration `20260418000000`) |
| RLS staff permission check | `public.check_staff_permission(uuid, uuid, text, text)` |
| Order row access | `public.can_access_order(merchant_id, customer_id)` (`20260504010000`); `orders` / `order_items` SELECT policies delegate to it |
| Staff tables | `merchants`, `staff_members` (status `active`), `role_permissions` |
| Server client factory | `apps/web/src/lib/supabase/server.ts` → `createClient` (anon key, RLS enforced) |
| Mobile bearer client | `apps/web/src/lib/supabase/anon.ts` + `apps/web/src/lib/supabase/scoped.ts` |

### 1.2 Branch model (gate: branches are NOT an authorization boundary)

- `docs/branch-authorization.md` (verified): branches provide operational
  scoping only. No server-enforced `staff_branch_assignments` model exists.
- `branches` table + `branch_id` on `orders`, `variant_inventory`, `expenses`
  (`20260430120000_branch_scope_foundation.sql`); branch CRUD at
  `apps/web/src/app/api/branches/[id]/route.ts`.
- Consequence: the R0 spike enforces the grant branch allowlist server-side
  in the gateway (intersection on every call; selectors contained), but
  RLS-level branch confinement is impossible until the
  `staff_branch_assignments` + RLS rollout lands. No merchant-wide staff
  permission exists in the authorization layer today, so the implemented
  pilot cohort is **owners only** (enforced in both the resolver and the
  grant-creation RPC). Branch-scoped connector users stay disabled. That
  restriction is a scope reduction from the plan's branch-scoped proof,
  not evidence that the proof passed.

### 1.3 Orders, payment, fulfillment, cancellation

- Order RPCs/columns: `payment_status` (`unpaid|pending|paid|...|refunded`),
  `shipping_status` (`pending|processing|...|cancelled`), `amount_paid`,
  `cancelled_at`, `cancellation_reason`, `cancelled_by`
  (`merchant|customer`); `create_storefront_order`, `get_order_tracking`
  (baseline migration).
- Customer self-cancel: `public.cancel_order_as_customer` +
  `public.customer_order_can_cancel` + `private.restock_order_items` +
  `private.order_customer_cancellable` (`20260615120000`); eligibility is
  unpaid + unshipped + no in-flight/captured payment transaction. Route:
  `apps/web/src/app/api/storefront/account/orders/[id]/cancel/route.ts`.
- Merchant cancel audit + side-effect claims:
  `20260721093206_merchant_order_cancellation_audit.sql`,
  `20260721093207_order_cancellation_side_effect_claims.sql`
  (`claim_order_cancellation_side_effect`, `order_cancellation_side_effects`
  with `claimed|delivery_uncertain|completed|failed`, refund + customer_email
  steps, Paystack reconciliation before replay).
- Wallet/savings reversal: `20260723000007_credit_customer_wallet_order_refund.sql`,
  `20260723000014_mark_savings_redemptions_reversed.sql`.
- Paid-order completion hardening:
  `20260721093205_harden_paid_order_completion_and_side_effect_retries.sql`.
- Shipment booking lock: `claim_order_shipment_booking` (baseline) +
  `apps/web/src/lib/shipping/order-shipment-booking-lock.ts`.
- Provider booking lives at `apps/web/src/app/api/shipping/book/route.ts`
  (+ `lib/shipping/book-order-shipment.ts`); self-fulfillment at
  `apps/web/src/app/api/shipping/self-fulfill/route.ts` (still sends push
  notification via `notifyOrderStatusChange`).
- Shipped-notification coupling confirmed: `POST
  /api/orders/[id]/shipped/route.ts` is the manual-send endpoint and notes
  that normal shipped notifications are queued by the **order notification
  outbox when `shipping_status` changes** — i.e. the status transition and
  the customer notice are coupled today. R3 must isolate or explicitly govern
  that effect before exposing `mark_shipped`.

### 1.4 Events, outbox, audit

- Domain-event pipeline RPCs (`apps/web/src/lib/events/event-pipeline-database.ts`
  `EVENT_PIPELINE_FUNCTION_NAMES`): `enqueue_domain_event_v1`,
  `route_domain_event_v1`, `read_domain_events_v1`,
  `claim_event_deliveries_v1`, `finish_event_delivery_v1`,
  `replay_event_delivery(s)_v1`, `dead_letter_ingress_event_v1`,
  `record_platform_domain_event_v1`, `record_analytics_domain_event_v1`, etc.
- Workers: `apps/web/src/scripts/domain-event-worker.ts`,
  `domain-event-worker-batch.ts`; enqueue helper
  `apps/web/src/lib/events/enqueue-paid-order-domain-event.ts`; route
  `apps/web/src/app/api/events/route.ts`.
- Audit: `audit_logs` table via `apps/web/src/lib/audit-logger.ts`
  (`logAudit`; domain/dns/email-forwarding focused) plus order-edit audit
  (`20260626185602_mobile_admin_order_edit_audit.sql`) and staff-access audit
  (`20260730000200_audit_staff_access_changes.sql`).
- R2 inbox design (not yet implemented): project from committed source rows
  with a post-commit per-tenant counter (never `nextval`/identity as the
  client cursor), unique source-event id, grant-bound cursor. Reuse
  `enqueue_domain_event_v1` as the canonical append path; the projector is
  new code behind the R2 gate.

### 1.5 Carts and checkout sessions (recovery surface)

- Server-side sessions exist for agentic commerce:
  `apps/web/src/app/api/agentic/checkout-sessions/**` and
  `checkout_sessions/**` (create/get/update/cancel/complete),
  `apps/web/src/app/api/agentic/carts/[id]/route.ts`,
  `apps/web/src/lib/agentic/ucp-cart-storage.ts`,
  `checkout-session-record.ts`, idempotency storage
  (`idempotency-response-storage.ts`), `agent-commerce-manifest.ts`, and the
  `agent-commerce.json` discovery route.
- Standard storefront carts persist locally (no server abandonment detector,
  no marketing frequency-cap/suppression tables found). R4 covers
  server-side checkout sessions / payment attempts only; local-only carts
  stay excluded until a capture design lands.

## 2. Connector grant model (R0 spike)

Table `public.connector_grants` (migration
`20261001090000_connector_grants_r0.sql`):

- `connection_id` (unique Muse connection id), `user_id` (Baci user),
  `merchant_id` (single-tenant boundary), `branch_ids uuid[]` (explicit
  allowlist; empty means no branch access, never "all"),
  `scopes text[]` (deny by default), `status` (`active|revoked|expired`),
  `token_hash` / `refresh_token_hash` (sha256 hex of opaque tokens; no
  secrets stored), `version` (grant/policy version, bumped on
  permission-affecting change), `expires_at`, `revoked_at`, timestamps.
- RLS + least privilege: merchant members (`has_merchant_access`) hold
  column-scoped SELECT on grant metadata only — `token_hash` /
  `refresh_token_hash` are excluded. No INSERT/UPDATE/DELETE privilege is
  granted; all writes go through SECURITY DEFINER RPCs (CodeRabbit
  authorization review applied).
- `create_connector_grant(...)` binds `user_id` to `auth.uid()`, verifies
  merchant access + manager authority (owner or `settings:edit`), restricts
  `merchant_wide` to owners, and validates the scope allowlist, branch
  ownership, and hash format. Staff without `settings:edit` cannot
  self-connect, which reinforces the owners-only pilot cohort; any future
  staff issuance flow needs its own design and tests.
- `rotate_connector_grant_tokens(...)` authenticates by the presented
  refresh-token hash (the gateway holds no user session), rechecks live
  membership, and rotates atomically; scopes/branches/merchant binding are
  untouched, so refresh cannot expand authority. Predecessor refresh hashes
  are single-use. `EXECUTE` is restricted to the `connector_gateway` role,
  as is the resolve RPC.
- `revoke_connector_grant(p_grant_id, p_reason)` revokes one grant after
  verifying `has_merchant_access`; executed by the revoking member. A
  status-flow trigger enforces forward-only transitions
  (active→revoked/expired, expired→revoked).

Authorization sequence (spike: `apps/web/src/lib/connector/authorize.ts`):

1. Look up grant by token hash; require `status = active`, unexpired,
   version match.
2. Resolve grant `user_id` → live access via the existing `get_user_access`
   path; user must still be owner or active staff of the grant merchant.
3. Re-evaluate live role permission for the tool's resource/action; role
   removal or suspension denies on the next call.
4. Intersect requested scope, grant scope, live permission, branch
   allowlist. Tool arguments `merchant_id`/`branch_id` are selectors only
   and must be contained by the grant; cross-merchant or out-of-allowlist
   selectors return `BRANCH_NOT_ALLOWED` / `FORBIDDEN_SCOPE`.
5. Enter the existing RLS path (open decision §4), execute, and audit with
   effective merchant, branch set, user, grant, policy version.

## 3. Muse compatibility (summary; full record in `muse-r0-evidence.md`)

Verified from public sources (Meta Help Center "How Muse works with
Connectors", muse.ai/platform, vendor connector reports):

- Private custom connectors exist: a user asks Muse to create one, Muse
  retrieves API information from the service, credentials live in Muse's
  Secure Credentials Store. Directory listing requires Meta submission +
  review. **Decision: private custom connector for the pilot** (recorded in
  `docs/adr/002-muse-private-connector-pilot.md`).
- Disconnect stops data exchange; Muse approvals are a UX gate
  (configurable in Settings; connectors can be read-only). Meta's Sentinel
  enforces approvals as capabilities bound to connector/destination and use
  case, but Meta documents no externally verifiable receipt Baci can accept.

Not verifiable from public sources (pilot-environment proof still required):
token refresh/rotation semantics, server-side revocation callback, tool
manifest/schema discovery protocol, scheduled-check cadence and cursor
resume support, connector error taxonomy, and — critically — a
Baci-verifiable operation-specific approval receipt. No such receipt has
been demonstrated; the plan's fallback therefore applies: **Baci issues
and verifies its own approval proof before any sensitive write** (spike:
`apps/web/src/lib/connector/approval-proof.ts`; money-moving commands stay
disabled until the R5 proof gate passes end to end).

## 4. Open decisions (blocking later phases)

| Decision | Owner | Deadline | R0 position |
|---|---|---|---|
| Exact RLS entry path for connector calls | Platform + security | End of R0 | Resolved: C-prime (resolve RPC + gateway SET LOCAL), proved on scratch and the full-schema branch. Production-scope ADR-003 acceptance remains required before R1 routes. |
| Branch grant UX + `staff_branch_assignments` rollout | Product + platform | End of R0 | Pilot = owners only until the model exists. |
| Approval proof source | Security + Muse pilot | Before R3 | Baci-owned proof; no Baci-verifiable platform receipt demonstrated. |
| State enum mapping | Orders team | End of R0 | Mapped §1.3; connector schemas map to canonical values. |
| Event/outbox mapping | Platform team | End of R0 | Mapped §1.4; projector design only. |
| Cursor projection/lock + retention | Platform + database | Before R2 | Design rules in spike `cursor.ts`; no DB code yet. R2 must also HMAC-sign cursor payloads (server key, constant-time verify) so a forged forward position cannot skip events. |
| Shipment side effects | Orders + shipping | Before R3 | Coupled notice confirmed; isolate before R3. |
| Provider reconciliation / recovery claim | Growth + platform | Before R4 | Server sessions exist; claim/cap design pending. |

## 5. RLS entry path (resolved: option C-prime)

The gateway translates connector identity but must not substitute a
privileged role for authorization. Candidates considered:

- **A. Short-lived user JWT exchange.** Rejected for R0: requires a
  service-role exception (all legacy exceptions expired 2026-09-16; none
  currently valid) and owner approval with exact scope + expiry. Remains a
  fallback if C-prime proves inoperable.
- **B. Constrained SECURITY DEFINER RPCs per tool returning rows.** Rejected:
  RLS is bypassed inside the RPC body, forcing replicated policy logic and
  a parallel authorization system.
- **C. Per-request Postgres role + claims injection.** Adopted in refined
  form (C-prime) below.
- **D. In-RPC SET ROLE impersonation.** Invalidated by proof: PostgreSQL
  forbids `SET ROLE` inside `SECURITY DEFINER` functions (`cannot set
  parameter "role" within security-definer function`, observed on scratch).

**Resolved design (C-prime).** Each connector call runs as one audited
sequence over a direct pooled connection as a least-privilege
`connector_gateway` role (member of `authenticated`, `EXECUTE` on the
resolve RPC only):

1. `resolve_connector_grant_context(token_hash, scope, resource, action,
   branch_ids)` validates the token (hash, active status, expiry),
   re-evaluates live permission via `check_staff_permission`, checks the
   scope allowlist and branch containment, and returns the grant context.
2. The gateway opens a transaction, runs `SET LOCAL ROLE authenticated`
   plus `set_config` of `request.jwt.claim.sub/claims` to the resolved
   user, then issues the tool's normal scoped reads.
3. Every row flows through the existing RLS policies as the linked user.
   Missing claims fail closed (zero rows).

No service-role client, no JWT minting, no replicated policy logic. The
gateway role inherits `authenticated`'s table grants (required for
`SET ROLE`), so RLS — not table privilege — is the enforcement point; the
proof asserts the zero-row fail-closed property. The gateway must
rate-limit token-hash lookups at the edge and audit every call.

**Proved (scratch Postgres with exact policy-body replicas of
`has_merchant_access`, `check_staff_permission`, `get_staff_permissions`,
`can_access_order`, and `orders_select_policy`):** owner read equals the
direct app-shaped RLS read; branch-scoped staff read is contained;
cross-merchant rows invisible; revocation, suspension, missing permission,
and out-of-allowlist selectors denied; fail-closed without claims. The
isolated R0 harness (`apps/web/tools/connector-harness/`) runs this exact
sequence over HTTP and was verified end to end (issue, bounded reads,
rotation, revocation, denials) against scratch.

**Architecture authorization:** C-prime changes the database-access
architecture, so it is recorded in
`docs/adr/003-connector-gateway-database-access.md` as **accepted for the
isolated R0 proof and read-only staging pilot through 9 October 2026**,
covering role shape, accessible surface, tool→scope mapping, claim
provenance, transaction/pool cleanup, and evidence. Its granted
authorization is recorded in `muse-r0-authorization.md`, and it stays
confined to that isolated harness/pilot. Production authorization remains
a separate decision after the full-schema and real Muse proofs.

**Full-schema confirmation (complete 2 Oct 2026):** the branch was
restored from the owner-supplied schema-only snapshot after migration
replay proved unrepairable (the branch ledger still reads
`MIGRATIONS_FAILED`, which no longer gates the proof). Parent-vs-branch
comparison shows exact matches on relations, columns, all 397 RLS
policies, all 1,151 function bodies, triggers, indexes, sequences,
views, extensions, and all grant content, with only explained deltas
(4 semantically-null boolean-flattening diffs, 3 unrunnable
`supabase_admin` default-privilege rows, rotating managed realtime
partitions). Full record in `muse-r0-branch-proof.md`.

The proof caught one real blocker: `resolve_connector_grant_context`
denied every gateway call because production's permission helper
requires a user session the gateway does not hold at resolve time.
Fixed in the unreleased R0 migration (resolve sets transaction-local
claims to the validated grant's linked user before the permission
check), with red-green controls on both the branch and the refreshed
scratch fixture. Gateway-role provisioning, pooler access, and secret
management for production remain R1 work. No R1 connector routes
until the pilot completes.

## 6. R0 exit status

Local R0 spike implemented; isolated R0/staging authorization granted;
Full-schema branch proof complete; R0 exit gate pending the real Muse
pilot. The following checks are established at unit + migration-test level:

- Grant lifecycle shapes (the lifecycle test uses an in-memory fake store:
  it proves resolver/rotation/revocation logic, not a Muse round-trip).
- Authorization resolver: cross-tenant/branch denial, scope deny-by-default,
  revocation/expiry enforcement, live role re-evaluation.
- Manifest stability + JSON Schema conformance for the four R1 read tools
  (data only, no routes).
- Cursor binding/advance rules and approval-proof verification rules as pure
  functions with tests.

Still required for the R0 exit gate: production-scope resolution of
ADR-003 before R1 (the R0/staging scope is already accepted;
full-schema confirmation completed 2 Oct 2026, see
`muse-r0-branch-proof.md`),
and the exact pilot connect/refresh/revoke/discovery results (or concrete
blockers/fallbacks per the pilot runbook). The NULL scope-array bypass is
fixed at issuance, storage, and resolve layers with regression coverage.
R1 production implementation stays gated until all of these pass, as do
every R2–R5 gate in the plan §10.
