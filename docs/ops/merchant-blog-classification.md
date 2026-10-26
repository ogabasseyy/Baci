# Merchant blog classification rollout

Status: implementation and disposable tests only. No hosted migration, writer
provisioning, classification backfill, publication or production deployment is
implied by this document.

## Contract

Keep `blog_posts.intent` and `intent_source` NULL for merchant posts. Those fields
remain platform editorial metadata. Merchant intent lives in
`merchant_blog_classifications`: `news`, `comparison`, `repair-guide`, or
`buying-guide`, taxonomy version 1. Missing history stays unclassified.

Only authenticated owner/marketing editors can declare a classification. Only
an explicitly registered, unexpired merchant-scoped automation identity can
claim `verified_receipt` or `reviewed`. The database checks source authority,
post/merchant identity and the current server-derived input fingerprint. Current
reviewed evidence outranks receipt evidence, which outranks merchant declaration.
An identical retry is idempotent. Classification does not approve or publish.

The five public RPCs delegate through narrowly scoped, postgres-owned functions
with empty search paths and explicit role grants. Authenticated clients retain
no schema access to `private`; the private implementations enforce the request's
JWT identity, merchant scope and source authority before reading or writing.

Relevant changes to title, body, category, excerpt, tags or keywords invalidate
the stored classification. A server-maintained `classification_revision` changes
only with these inputs, not view counters. Public caches compare that revision
without hashing article bodies during rendering. Unclassified, stale and
unavailable classifications fall back to existing narrow heuristics.

Public reads expose only safe fields for published, non-future merchant posts
on enabled blogs. Private evidence, actor identity and audit records are not
exposed. The authorized metadata snapshot is separate from the smaller full
article-context RPC, so daily reporting does not download every article body.

## Deployment order and gates

1. Review and merge the migrations and readers. Registered pending-source hashes
   are replay inputs, not proof of a production migration.
2. Apply the seven `20261025*_merchant_blog_classification_*.sql` migrations in
   timestamp order through the approved database workflow. Verify table grants,
   functions, trigger invalidation and the unchanged merchant-intent NULL check.
3. Deploy web using the approved VPS prebuilt production flow. A code merge is
   not a deployment; do not use a Codex-side build or automatic fallback deploy.
4. Provision or reuse an approved normal authenticated automation identity. Add
   only the intended merchant, `verified_receipt` source and a finite expiry to
   `private.merchant_blog_classification_writers`. Do not grant `reviewed` unless
   an actual authorized human-review workflow will use it. Do not grant table
   access or use a service-role token as the classification credential.
5. Arrange a secure short-lived token refresh/delivery mechanism before enabling
   daily writes. A manually supplied access token that expires in an hour is not
   a complete daily-runner setup. Keep tokens out of source, patches and output.
6. Compare the VPS source against the patch's baseline hashes before applying.
   The live writer checkout is dirty; do not replace it wholesale or reset it.
7. Dry-run receipt-backed proposals for a bounded iPhone pilot. Validate receipt
   and artifact hashes, task/topic/product contracts, and current article text.
   Review missing or mismatched evidence; never fabricate legacy classifications.
8. Apply only the reviewed pilot, inspect each CAS response and cache revalidation
   result, and verify rendered guide links and the inventory coverage report.
   Expand only after the pilot is correct. Do not change article text, dates,
   approvals, schedules or publication status as part of classification backfill.

### Revision-column migration preflight

A read-only query against the Baci production project on 2026-10-25 found 1,064
`blog_posts` rows, a 3,309,568-byte heap, and 38,838,272 total bytes including
indexes and TOAST. The volatile UUID default rewrites the table under an
exclusive lock; the current small table supports retaining the single migration.
This is not a zero-downtime guarantee. Recheck size and active transactions just
before deployment, use the approved migration runner's bounded lock/statement
timeouts, and stop rather than waiting behind a long transaction. If the table
has grown substantially, use a separately reviewed staged nullable/backfill/
constraint rollout instead. No production DDL was executed during this check.

## Writer integration

The separate Python writer repository is `/home/bassey/ogabassey-agents`; it is not
part of the Baci deployment bundle. The candidate [writer patch](merchant-blog-classification/writer.patch)
and [baseline manifest](merchant-blog-classification/writer-baseline.json) must
be reviewed and applied separately. The manifest records the captured dirty
working-file hashes as well as HEAD; checking HEAD alone is insufficient.
`git apply --check` against that captured baseline passes. Before any live apply,
compare every existing file to `before_sha256` and require new files to be absent.
After applying, compare all six files to `after_sha256` and rerun the writer tests.
Existing publisher behavior is preserved: after the
release receipt is written, classification is a best-effort authenticated RPC.
Failure is reported as unavailable; it must not retry or duplicate publication.

Required configuration is `SUPABASE_URL`, a public `SUPABASE_ANON_KEY` or
`SUPABASE_PUBLISHABLE_KEY`, and `MERCHANT_CLASSIFICATION_ACCESS_TOKEN_FILE` supplied
by the approved token delivery mechanism. Only HTTPS is accepted; redirects and
service-role credentials are rejected. No `.env` change is included here.

The backfill command is read-only without `--apply`:

```sh
python -m scripts.backfill_merchant_blog_classifications --run-root /reviewed/pilot/runs --merchant-id APPROVED_MERCHANT_UUID --limit 20
```

The run-root must hold the reviewed original receipt/artifact tree; do not copy
receipts away from their hash-validated artifact layout merely to select them.

Analytics use explicitly named effective-intent fields and preserve platform
columns. Reports label their basis as current classification at report time.
Per-group signatures identify changes in membership, classification source or
version; historical comparisons are not classification-stable unless these
signatures match. Unknown/stale coverage is reported, not hidden.

## Validation and rollback

Run the disposable SQL suite:

```sh
bash supabase/tests/run-merchant-blog-classification.sh
```

Run affected storefront-content/listing/detail tests, web lint/typecheck, the
migration-registry tests, and the separate writer's classification/outcome tests.
The test runner creates and removes only its own network-isolated PostgreSQL
container. Never point fixture SQL at a hosted database.

Rollback readers/writer first. Disable the specific writer registration to stop
new trusted classifications. Leave the additive schema and private audit trail
in place; do not drop records or rewrite original merchant posts. Fix schema
issues with a new append-only migration.
