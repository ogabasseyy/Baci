# Reviewer account and verification plan (not a submission)

Status: **not ready for submission**. The deployed connection, exact callback,
reviewer account and end-to-end evidence remain unverified. This submission targets the full-code experience surface; the legacy
homepage-only inventory does not qualify it. See
[`full-code-review-cases.md`](full-code-review-cases.md) for the additional draft
cases and their execution status. Do not attach this source to an existing
submission without verifying its identity and saved version.

## Account preparation

Prepare two isolated synthetic merchant owners in the explicitly qualified test environment: one without a store and one with an existing synthetic draft. Use no real customer, catalog, order or payment data. Deliver any test credentials only through the approved private review mechanism; never include passwords, refresh tokens or secrets here or in the ZIP. Fill in the verified login URL, account instructions and recovery/contact procedure only after that environment and access are qualified. A local or staging test does not establish the production connection is working.

## Supported workflow

The submission targets full React/TypeScript/CSS storefront authoring. The agent
supplies source; Baci builds and verifies it without calling an AI provider.
Do not use the legacy natural-language `update_storefront_draft` path as proof
of this workflow or invoke it during the no-extra-AI-cost test.

1. Link a synthetic owner through the actual ChatGPT OAuth connection. Read
   `get_experience_capabilities`. Verify the linked merchant and supported
   runtime. Missing experience tools is a failed connection qualification.
2. If needed, create the explicitly consented private synthetic store through
   `create_storefront_draft`, then read capabilities again. Keep the same account
   and merchant throughout the journey.
3. Author custom source and upload through `begin_experience_upload`,
   `write_experience_chunk`, `finalize_experience_upload`, and
   `read_experience` with `adopt-upload`. Retain the exact artifact and version.
   To edit in a new chat, use `read_experience` with `head`, then patch against
   the returned version and digest. After a conflict, read the head again and
   reconcile the change before retrying.
4. Call `build_experience`, poll `get_experience_operation`, and reconcile with
   `finalize_experience_build`. A queued job is not a completed build.
5. Use `preview_experience` and `read_experience_evidence` for the exact build.
   Check custom interactions and responsive rendering. Distinguish simulated
   preview shopping from authenticated Baci commerce checkout verification.
6. Request `apply_experience`, inspect the signed-in owner review page and
   confirm only the intended private draft change. Test supported synthetic
   catalog, cart and shipping through the final checkout screen; never place
   an order or initiate payment. Record whether this runs in ChatGPT or the
   linked owner browser rather than claiming they are the same surface.
7. Verify the public head is unchanged. Do not confirm publication or submit
   the plugin. Save exact connection, source/build revision and test evidence
   for the owner's review.

## Expected negative behavior

Use isolated owners to test wrong tenant, removed ownership, revoked/expired grants, stale revisions, duplicate/conflicting keys, unsafe model output, blocked launch requirements and delivery/cache failure. Stale source versions require a fresh read; unsupported capabilities must be reported from the capability response rather than invented. A failed delivery stays verifying without automatic republish/unpublish. Test a later native publication/unpublish superseding the old receipt, plus owner-session recovery after the ChatGPT connection expires.

The portable-homepage tool inventory is: `list_storefronts`, `get_storefront_status`, `create_storefront_draft`, `update_storefront_draft`, `get_storefront_operation`, `apply_storefront_operation`, `preview_storefront`, `publish_storefront`. The last tool requests approval; it never confirms on the model's behalf. When full-code experiences are enabled, the MCP registry also exposes the experience tools listed in `full-code-review-cases.md`; their presence in source does not establish that the deployed connection has them enabled or working.

When background builds are enabled, `finalize_experience_build` reads the job
status; queued or running does not mean the build is complete. Reconcile a
disconnected response with `get_experience_operation` using the same job ID.

## Demo capture checklist

Record a real journey in the qualified reviewer-accessible environment: linking/consent, full-code capability discovery, synthetic private store, source upload/adoption, build/status/finalization, exact preview and private owner approval. Stop before publication, order creation or payment. Include one blocked-readiness example and capture viewport/host behavior without exposing credentials or synthetic account personal details. A local static fixture recording is not a substitute for this demo, and a recording from a test environment does not establish production OAuth or delivery.
