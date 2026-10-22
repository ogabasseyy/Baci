# Reviewer account and verification plan (not a submission)

Status: pending isolated staging, exact callback and developer-host qualification. Do not upload this source or attach it to either existing submission.

## Account preparation

Provision two synthetic staging merchant owners: one without a store and one with a published portable homepage. Use no real customer accounts/catalog/order/payment data. Give both access only to the disposable staging project. Deliver any test credentials through the approved private review mechanism after staging approval; never include passwords, refresh tokens or secrets here or in the ZIP. Fill in the verified staging login URL, account instructions and recovery/contact procedure only after it is live.

## Supported workflow

1. Ask “Create a private electronics store homepage named Review Store.” Link the Baci account through OAuth and explicitly allow store creation. Confirm the tool creates a draft and does not publish it. Read status with the same linked connection afterward.
2. Ask “Change the homepage heading to Welcome to Review Store.” Read operation status without starting another job. Apply the ready candidate only when explicitly requested. A provider failure must not claim success or publish anything.
3. Ask to preview the exact current draft revision. Check rendering at narrow, medium and wide widths, host light/dark settings and fullscreen. Catalog fields are published-data snapshots; controls are inert. No private draft URL or arbitrary credential-bearing link should appear.
4. Ask to publish that revision. This returns a Baci approval link. Sign in as the same owner; review the exact homepage, destination and revision, then confirm explicitly. A ChatGPT message or model-provided boolean cannot replace this action.
5. Check the publication receipt. “Verifying” is not live. Verify the public content/version and loaded images before accepting “live.” Repeat status reads and simulate a lost response; only one publication/history/audit/receipt should exist.
6. For the existing merchant, compare public content before and after every draft/edit/preview step. It must stay unchanged before confirmation. Secondary pages, SEO and pending store/setup settings must remain unchanged after the homepage-only publication.

## Expected negative behavior

Use isolated owners to test wrong tenant, removed ownership, revoked/expired grants, stale revisions, duplicate/conflicting keys, unsafe model output, blocked launch requirements and delivery/cache failure. Stale drafts ask for a fresh revision; unsupported templates/pages direct the owner to the authenticated Baci editor. A failed delivery stays verifying without automatic republish/unpublish. Test a later native publication/unpublish superseding the old receipt, plus owner-session recovery after the ChatGPT connection expires.

Accepted tool inventory must contain exactly: `list_storefronts`, `get_storefront_status`, `create_storefront_draft`, `update_storefront_draft`, `get_storefront_operation`, `apply_storefront_operation`, `preview_storefront`, `publish_storefront`. The last tool requests approval; it never confirms on the model's behalf.

## Demo capture checklist

Record a real staging-host journey only after qualification: linking/consent, new-store draft, edit/status/apply, exact preview, explicit Baci confirmation and independently verified public revision. Include one blocked-readiness example and receipt recovery. Capture viewport/host behavior, latency and quota usage without exposing credentials or synthetic account personal details. A local static fixture recording is not a substitute for this demo.
