# Builder review follow-up — 15 November 2026

Scope: PR #4203, synthetic qualification only. This is not a deployment,
publication, checkout/order or ChatGPT submission receipt.

## Valid findings fixed in this batch

- Configuration and consent now share the same 30-day connection lifetime
  limit. The parser regression rejects 2,592,001 seconds and the former
  31-day maximum.
- The runner and authorization broker recover a stale, same-user Unix socket
  after an unclean exit. They reject non-socket entries and preserve a live
  listener. Recovery checks the inode again before unlinking. Startup must be
  serialized by a single supervisor for the shared socket path: this is not
  an atomic multi-process lock. Stop standalone qualification before starting
  the full stack on that path.
- Explicit finalization of an already-finalized background job uses existing
  owner-scoped recovery to restore missing renderer output. Pending operations
  continue to return immediately. The supervisor retains its existing build
  identity checks and recovery bounds.
- Startup and shutdown failures identify a fixed lifecycle phase without
  logging underlying exception text, credentials or provider responses.
- Preview request deadlines and disconnects reach the normal user-scoped
  Supabase client's Auth and PostgREST fetches. Transport tests retain all
  occupied slots until admitted work actually settles. Fetch cancellation
  does not imply rollback of a remote database statement.
- The dedicated nonce pool uses a three-second connection/acquisition limit
  a three-second driver read timeout, and PostgreSQL-enforced two-second
  statement and one-second lock limits.
  Production startup verifies the effective server settings. A disposable
  PostgreSQL regression verifies lock timeout (55P03), statement timeout
  (57014), and rejection of an unbounded session. No live SQL was changed.

## Earlier findings checked against current code

- Production boot forwards the background scheduler; its regression verifies
  the original scheduler reference.
- Colima is only required by the opt-in local browser qualification script.
  Native Linux assembly does not import that setup.
- Private capture filters the merchant/build and app.js/app.css before its
  row limit, then verifies digests.
- Public MCP ingress rejects owner paths. The separate owner ingress requires
  signed admission; the HTTPS candidate additionally requires a client
  certificate. Owner services are not yet activated.

## Remaining release evidence

The pushed pre-fix head was 0729c4047d. Its quick lint, typecheck, miscellaneous
checks and Semgrep passed. That does not qualify the changes in this batch.
Codex and Muse returned quota notices rather than clean current-head reviews.
Muse reported 16 November 2026 00:00 UTC (01:00 Lagos) as its reset. Keep the
PR draft until both exact-head/base reviews satisfy repository policy.

The updated runner passed a two-generation Contabo crash/restart trial; see
[the exact runner receipt](runner-next-install-20261115.md). Both generations
compiled synthetic code and denied unsigned/replayed requests. The complete
operator package at e975c5c86f was staged root-only, but was not activated or
qualified as a full production stack. Affected-package lint and typechecks
passed after the final source changes; GitHub checks still need the new head.

Live OAuth requires the dedicated consent route deployment, upstream OAuth
activation and client registration, the exact client UUID configuration, the
restricted database login, and private broker configuration. Then qualify
direct builder DNS/TLS, OAuth and authenticated MCP discovery while preserving
the commerce connector.

Full-code delivery still requires a separately qualified execution origin.
Before general owner-bridge activation, qualify bounded underlying work,
deadline/disconnect handling, saturation and shutdown. An HTTP timeout alone
does not prove that dependent work has stopped. Focused synthetic checks now cover request-local cancellation through user and
anonymous RLS reads, canonical lookup, preview liveness and runner transport.
The verifier has a 550-second request deadline and keeps admission slots until
handlers and cleanup settle. Public DNS, fetch, relay and browser observation
observe cancellation; tests cover stalled responses, saturation and shutdown.
Disposable PostgreSQL checks verify that a driver read timeout discards the
pooled connection. These are local component receipts, not complete live stack
qualification. A disconnected caller does not terminate already admitted remote
runner work; the runner retains its own slot and process limits until completion.

The actual ChatGPT synthetic merchant build/preview and final-checkout test
remain pending. Do not label the app submission-ready or submit it on the
basis of source tests or metadata discovery alone.


## 18 November follow-up

The owner preview work deadline is 90 seconds and its client allows 100
seconds. Signed admission still has its original freshness window. This
gives the 75-second runner request time to complete while keeping request
cancellation and slot accounting in place.

Private build verification has a separate 1,200-second server deadline and
a 1,250-second caller deadline. Its maximum sequential matrix includes two
compiles, one prerender, and twelve captures, each with a 75-second runner
budget. Public verification, capture and attestation retain the 550-second
server deadline. Live full-stack timing and shutdown remain rollout checks.

The generic transport challenge advertises protected-resource metadata
without assuming a tool scope. The auth fixture uses the current builder
issuer and explicitly tests rejection of the former issuer. Both capture
entry points validate the idempotency key as a UUID before replay lookup.
Background lease renewal and recovery apply to connection-bound builds.
Native owner finalization remains outside that worker lease contract.
