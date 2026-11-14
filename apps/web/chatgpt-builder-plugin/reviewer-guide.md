# Reviewer account and verification plan (not a submission)

Status: **not ready for submission**. The deployed connection, exact callback,
reviewer account and end-to-end evidence remain unverified. The source now also
contains an optional full-code experience surface; the homepage-only inventory
and demo below do not qualify that surface. See
[`full-code-review-cases.md`](full-code-review-cases.md) for the additional draft
cases and their execution status. Do not attach this source to an existing
submission without verifying its identity and saved version.

## Account preparation

Prepare two isolated synthetic merchant owners in the explicitly qualified test environment: one without a store and one with an existing synthetic draft. Use no real customer, catalog, order or payment data. Deliver any test credentials only through the approved private review mechanism; never include passwords, refresh tokens or secrets here or in the ZIP. Fill in the verified login URL, account instructions and recovery/contact procedure only after that environment and access are qualified. A local or staging test does not establish the production connection is working.

## Supported workflow

1. Ask “Create a private electronics store homepage named Review Store.” Link the Baci account through OAuth and explicitly allow store creation. Confirm the tool creates a draft and does not publish it. Read status with the same linked connection afterward.
2. Ask “Change the homepage heading to Welcome to Review Store.” Read operation status without starting another job. Apply the ready candidate only when explicitly requested. A provider failure must not claim success or publish anything.
3. Ask to preview the exact current draft revision. Check rendering at narrow, medium and wide widths, host light/dark settings and fullscreen. Catalog fields are published-data snapshots; controls are inert. No private draft URL or arbitrary credential-bearing link should appear.
4. Ask to request approval to publish that revision. If the tool permits the request, it returns a Baci owner-review link. Verify the exact homepage, destination and revision shown to the signed-in owner. Stop before confirming publication. A ChatGPT message or model-provided boolean cannot replace owner approval.
5. Check that the request remains an unconfirmed intent and that no publication receipt is represented as live. Repeat a status read and confirm that it does not create a duplicate intent.
6. For the existing synthetic merchant, confirm the public head remains unchanged throughout draft, edit, preview and approval-request steps. Do not create an order, initiate payment or confirm publication in this test.

## Expected negative behavior

Use isolated owners to test wrong tenant, removed ownership, revoked/expired grants, stale revisions, duplicate/conflicting keys, unsafe model output, blocked launch requirements and delivery/cache failure. Stale drafts ask for a fresh revision; unsupported templates/pages direct the owner to the authenticated Baci editor. A failed delivery stays verifying without automatic republish/unpublish. Test a later native publication/unpublish superseding the old receipt, plus owner-session recovery after the ChatGPT connection expires.

The portable-homepage tool inventory is: `list_storefronts`, `get_storefront_status`, `create_storefront_draft`, `update_storefront_draft`, `get_storefront_operation`, `apply_storefront_operation`, `preview_storefront`, `publish_storefront`. The last tool requests approval; it never confirms on the model's behalf. When full-code experiences are enabled, the MCP registry also exposes the experience tools listed in `full-code-review-cases.md`; their presence in source does not establish that the deployed connection has them enabled or working.

When background builds are enabled, `finalize_experience_build` reads the job
status; queued or running does not mean the build is complete. Reconcile a
disconnected response with `get_experience_operation` using the same job ID.

## Demo capture checklist

Record a real journey in the qualified reviewer-accessible environment: linking/consent, synthetic new-store draft, edit/status/apply, exact preview and the owner-review step. Stop before publication, order creation or payment. Include one blocked-readiness example and capture viewport/host behavior without exposing credentials or synthetic account personal details. A local static fixture recording is not a substitute for this demo, and a recording from a test environment does not establish production OAuth or delivery.
