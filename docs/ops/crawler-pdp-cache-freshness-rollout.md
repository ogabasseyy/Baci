# Crawler PDP freshness rollout

This change is a draft until the release gates below pass. It does not remove
Next's crawler metadata blocking or PPR bypass rules. A Cloudflare HIT can carry
an inherited `x-vercel-cache: BYPASS`; that header is not a new origin invocation.

## Change

Ogabassey's public PDP policy keeps `durablePdpPurge: false`, retaining
300-second downstream freshness. The 1800-second policy is implemented but
must not be enabled until the release gates below are complete.
Vercel remains at 300 seconds, browsers must revalidate, and the existing
86400-second stale windows remain unchanged. Private/authenticated requests,
queries and unsafe methods retain their existing exclusions. No comparison
rendering, bot classifier, provider credentials or outbox authority changes.

The cache-kind selector is extracted from the large proxy module. A merchant
without explicit durable PDP purge coverage retains the old five-minute policy;
a merchant without a provider purge policy receives no downstream cache header.

## Evidence and mandatory release gates

Read-only production checks on 2026-09-08 found enabled product/variant/category
membership/offer/spec triggers and 54 completed outbox records, with no other
statuses. The live product trigger covers deletion and old/new identifiers;
exact completion is claim-token/generation fenced before broad purge enqueue.
This snapshot is NOT an end-to-end mutation test.

Before marking this PR ready or deploying:

- Run the PostgreSQL outbox suite, including bulk, deletion, rename, variant,
  generation-race and failed-provider cases.
- On an approved test merchant, warm a PDP, change price/stock, rename,
  unpublish/delete and bulk-edit products; verify committed updates invalidate
  both provider layers, including old URLs. Do not mutate a real sale product
  merely to test this change.
- Verify Googlebot, Meta and ordinary browser HTML retains title, canonical,
  robots and product structured data. Check auth/session, RSC, prefetch, query,
  and draft requests cannot consume or populate public HTML cache entries.
- Confirm the Cloudflare rule respects origin TTL and the intended cache key.
- Run lint, typecheck, tests and required code review for the exact PR head.

## Measurement and rollback

For frequently requested unchanged entries, expiry-driven refresh opportunities
fall from at most 12/hour to 2/hour (83.3%). This is not a whole-invoice forecast:
purges, cold locations, eviction and long-tail first visits still cause work.
Compare equal windows using Cloudflare origin requests, Vercel CPU/memory and
error rates, not the inherited Vercel cache header on Cloudflare hits.

Rollback: remove Ogabassey's `durablePdpPurge` opt-in, deploy via the approved
prebuilt workflow, and purge already-cached HTML. A code rollback alone does not
shorten the TTL of existing Cloudflare objects.
