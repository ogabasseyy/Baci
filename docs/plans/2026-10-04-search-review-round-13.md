# Search review round 13 — PR #3616 conversations

## Fixes

- Keep comparison navigation available when loaded results remain after a search/page error.
- Catch unavailable browser session storage on read, hydration, and write; preserve comparison in memory.
- Require a purchasable option for every refined search match, including searches without price or condition filters.
- Move the raw candidate helper into the non-exposed `storefront_search_private` schema. Keep public listings bounded, preserve invoker security and RLS, and update all brand/category/processor/facet consumers.
- Add an append-only migration and pinned replay registration; historical migrations are unchanged.

- Follow-up Codex findings: state-based comparison membership prevents initial hydration mismatch; base-option comparisons revalidate availability; native skips fully vanished pages and web keeps page navigation; SQL fixture covers final offer/base/null-stock policy.

## Verification

- Native SearchScreenView: 13 passing Jest tests, including retained-results comparison navigation.
- Web comparison context, pagination, empty/out-of-range pages: 25 passing Vitest tests. Replay source pins: 1 passing test.
- PostgreSQL 17 disposable database: new fixture validates anonymous RLS, private helper placement, protected inventory grants, 100-row cap, second-page total, unavailable options, and facet/processor callers.
- Existing refinement fixture also passes against the new migration under anon.
- Full monorepo lint/typecheck passed before the follow-up fixes; repeated on the final changes. CodeRabbit was attempted but rate-limited; push follows the prior user waiver.
- Native comparison and pagination follow-up: 27 passing tests.

## Adjudicated review suggestions

- Frozen historical migrations remain transactional and version tracked; blanket idempotence guards would hide schema mismatches. The previously approved unmerged Cron guard remains in place.
- Standalone condition offers on variant products remain excluded because native and web purchase paths do not yet share a paired price contract.
- Native currency remains NGN until the app has a merchant currency and checkout contract; web uses merchant currency.
- Public assistance has no ambient session authority. Keep the existing origin/tenant/rate-limit contract rather than requiring browser-only CSRF tokens on native requests.

## Release prerequisites

Do not expose `storefront_search_private` in PostgREST API schemas. Product-request restricted-role credentials and Cron provisioning remain deployment prerequisites. This review does not authorize merge or deployment.
