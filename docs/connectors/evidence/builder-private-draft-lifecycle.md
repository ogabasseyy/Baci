# Builder private draft lifecycle — Task 4

Date: 2026-10-22. Base: `079926a961`.

## Scope

Local source and disposable fixture verification only. Neither the Ogabassey
ChatGPT submission nor the Muse submission was visited or changed. No production
schema, credentials, domains, store data, deployment or feature flag was changed.
`BUILDER_PRIVATE_STORAGE_ENABLED` remains false; the builder account-linking
surface remains inactive too.

The normal linked-user services create a private certified Puck homepage, list
and read a scoped store, and commit a validated candidate with an opaque website
revision. Task 5 still owns asynchronous editing; its operation table has read
policies but no application insert/update grants yet. Publication is not added.

## Database boundaries

- All commerce RPCs use `SECURITY INVOKER`, normal authenticated authority, RLS,
  `auth.uid()` and the canonical connection. They lock the connection before
  checking current scope, expiry, grant version, ownership and target consent.
- Creation preserves an incomplete owned placeholder and its established slug,
  reserves the canonical active subdomain while retaining an existing primary
  domain, saves a private homepage, binds pre-consented targets without changing
  the grant version, and records the result in one transaction. Configured stores
  return `STORE_ALREADY_EXISTS`. Address conflicts disclose no other tenant.
- The root domain is operator-owned private configuration, not a caller argument
  or user-controlled setting. A normalized unique domain reservation index fails
  closed on existing duplicate data; it never merges or reassigns domains.
- Draft content lives in `builder_page_drafts`; public page rows retain only
  published content and public metadata after contraction. Owner and permitted
  builder staff have private access. Anonymous users, unrelated tenants, other
  staff and the global service role gain no private-table grant.
- Website revisions cover private and public page changes, inserts/deletes and
  merchant identity/branding, including hero images and payout currency. The first
  effective write per transaction changes the opaque UUID; replay and semantic no-ops keep it.
  A nonblocking transaction advisory guard avoids the inverted legacy row-lock
  deadlock. Browser and native AI contention returns the existing safe 409 DTO.
- Canonical JSONB hashing, effect evidence and retained replay results live in the
  SQL transaction. The ledger is in the unexposed `builder_authorization` schema;
  normal clients receive JWT/Data API access, never PostgreSQL role credentials.
  Public API clients cannot insert ledger rows or select a private schema profile.
  Insert policies also require an active scoped target and its actual revision.
  Revocation is checked before replay. Expired replay retention requires
  reconciliation; it does not execute the mutation again. Audit failure rolls back.
- The existing guarded identity implementation is relocated unchanged into the
  unexposed schema, with its existing public-data authority. The original public
  RPC name becomes an invoker wrapper, so old clients cannot bypass private name
  synchronization. Only a normal caller with builder-edit permission rewrites
  private content; settings-only staff cannot use name changes to gain that power.
  No privileged function gains private-content access. The pure transform updates
  exact starter-owned names and preserves independently authored copy.

## Compatibility

Browser load/save/publish response DTOs remain compatible. Ordinary onboarding
keeps its existing automatic public homepage behavior; connector creation does
not call that provisioner. Browser publication preserves its authorized SEO and
settings promotion. Connector candidate commits update homepage layout only.

Native AI enqueue captures its starter under the normal caller's RLS. The
existing native worker consumes the stored snapshot, without a private-table
query or grant. The request DTO stays strict and the enqueue response excludes
that captured snapshot. Old uncaptured enqueue requests fail closed after cutover.
Builder asynchronous operations remain separate from that native queue.

## Verification and corrections

- Unit/service, browser/API compatibility, builder identity, onboarding and AI
  tests cover success, safe error handling and the existing auth/CSRF boundaries.
- Disposable PostgreSQL tests exercise placeholder reuse, reserved/occupied slugs,
  foreign domain collisions, primary-domain preservation, rollback on evidence
  failure, simultaneous duplicate requests, stale revisions, canonical revocation,
  retention, page deletion/secondary-page changes, no-ops and staff permissions.
- A signed builder token with empty targets creates through actual local
  PostgREST. The same token on the next request resolves the newly bound target,
  reads status and commits an unpublished edit. The fixture's `/auth/user` endpoint
  verifies the upstream JWT cryptographically; actual Supabase Auth lifecycle is
  independently covered by Task 3. This is not a live ChatGPT-host claim.
- Full frozen history plus the registered current-tree migration set was replayed
  on PostgreSQL 17.6. The replay tool needs a SQL check to include current-tree
  sources; the initial history-only run omitted those sources and is not acceptance
  evidence. The complete-schema run passes 31 raw Data API and lifecycle checks,
  using actual membership helpers and policies, followed by normal-user creation,
  domain reservation, binding, edit, old identity RPC and revocation assertions.
- Full-schema testing found and fixed a wildcard merchant read against column
  privileges. The smaller fixture now includes a protected merchant column.
  It also found the legacy rename transform lacked portable starter fields; the
  new pure private transform covers them without rewriting authored copy.
- Final scoped validation: 71 web test files / 348 tests and 20 isolated
  authentication/database tests pass. Web and isolated fixture typechecks pass.
- Codex review replaces CodeRabbit at the owner's request. Independent final
  review of the 48-file patch reports no actionable correctness or security
  findings. Production acceptance remains separate from that verdict.

## Coordinated release gate — not performed

Normal migration installation only defines an operator-only invoker procedure,
`builder_authorization.cutover_private_drafts()`. Application, service and broker
roles cannot execute it. Connector mutations also reject an uncontracted schema.
This prevents an ordinary schema rollout from dropping columns before compatible
artifacts and a maintenance window are ready.

A separately authorized release must retain a compatible rollback artifact,
finish/drain native layout jobs and old writers, stop admission, then run the
procedure in one operator transaction with
`SET LOCAL baci.builder_private_cutover = 'approved'`. It locks the affected tables,
rechecks the queue, reconciles drafts, drops public draft columns and switches
legacy writers atomically. Reapplication fails closed. Start only compatible web
and worker artifacts with the private adapters enabled before restoring traffic.
Never restore private drafts to public columns as a code rollback.

Staging DNS/HTTP resolution of the reserved host, post-publication delivery, live
OAuth/runtime provisioning and real ChatGPT UX remain separate release gates.
They have not been claimed from local SQL/API checks. Neither submission needs
any change for this source work.
