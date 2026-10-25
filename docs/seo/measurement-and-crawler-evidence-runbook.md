# Ogabassey acquisition and crawler evidence contract

Owner: storefront analytics/search maintainers. Version 1, 2026-10-25.
Applies to `capture_mode = public_blog_lightweight` and follow-up to SEO audit 06.
This contract is a release acceptance procedure, not a provider receipt or a claim of production results.

## Lightweight capture contract

- A public project token, analytics consent (`baci-cookie-consent.analytics === true`) and a non-bot user agent are required before capture or identity persistence. Missing/malformed/denied consent fails closed. Explicit default-key PostHog SDK opt-out in local storage or cookies also blocks capture. The existing consent event retries the current blog view when consent changes; route and unmount cleanup remove the listener. A grant event repeated on the same URL does not duplicate the view.
- `$current_url` excludes query/hash. `$referrer` contains only an external HTTP(S) origin, and `$referring_domain` only its hostname. Referrer credentials, paths, queries and fragments never enter the payload. Missing, invalid and same-host referrers use `$direct`; this means direct **or unknown/stripped/internal**, not proof the visitor typed a URL.
- Only `utm_source`, `utm_medium`, and `utm_campaign` survive, as single, 1–80 character ASCII taxonomy tokens (letters, digits, underscore, hyphen), excluding seven consecutive digits. Duplicate keys, free text, email/URL/phone-like values, click IDs, `utm_term`, `utm_content`, and arbitrary parameters are omitted. Campaign owners must never encode names or other personal data in taxonomy tokens; syntax validation cannot establish the meaning of an otherwise valid token.
- The first observed consented blog view freezes sanitized acquisition in document memory across SPA blog views. No campaign/referrer persistence is added. This is not necessarily the site's original landing if the first blog view occurs later. Consent denial clears this state. A document reload starts fresh. Exact repeated URLs deduplicate; query-only navigation still counts separately while URL query values stay redacted.
- Transport stays boot-free (beacon with keepalive fetch fallback). Existing identity continuity and bot filtering remain. Consent gating changes eligibility relative to historical lightweight traffic: annotate the release and do not infer traffic loss solely from changed counts. Historical missing attribution cannot be backfilled.

## Session and channel boundary

The installed `posthog-js` implementation (`lib/src/session-props.js`, `lib/src/utils/event-utils.js`, `lib/src/consent.js`) was inspected on 2026-10-25. It keeps acquisition with SDK session state and uses `$direct` for absent referrers. The lightweight implementation supplies neither a native `$session_id` nor SDK session-entry properties and does not implement SDK idle/max-duration or cross-tab lifecycle. Do not count these events as native Web Analytics sessions or claim channel equivalence.

[PostHog sessions](https://posthog.com/docs/data/sessions) defines SDK session IDs and session-entry properties. [Channel definitions](https://posthog.com/docs/data/channel-type) use landing referrer, campaign and advertising inputs; project custom rules can override defaults. This repair restores event-level referral/campaign evidence only. Omitted advertising identifiers and session fields limit native classification. Keep lightweight events separate until authorized aggregate verification establishes session/channel coverage; never synthesize IDs to improve a dashboard.

## Release verification

1. Record deployed commit, deployment ID and exact UTC cutover. Run local payload and tracker regressions before release. In a consented test browser verify Google, ChatGPT, Perplexity, no-referrer, UTM and SPA fixtures: one event per navigation; no private referrer path/query; no SDK boot caused by the tracker. Denied consent must send no event and create no identity. Synthetic fixtures establish payload behavior, not real provider referral/citation.
2. Use existing PostHog read access for a bounded aggregate check after the release. No person, order, event-detail or raw-URL exports. Review at most seven days initially; retain query text, project, UTC bounds, deployment annotation and aggregate result. Example below measures missing-property completeness, **not** whether a direct label is correct. Separate old and new windows by cutover; no retrospective rewrite.
3. Freeze an approved 28-day baseline plus preceding comparable 28 days once coverage is sound. Define tenant/host and surface cohorts (PDP, category, brand, commercial, blog, repair), device/country coverage, timezone, consent/bot/internal exclusions and classifier version. Keep unknown visible and label missing device/session coverage. Promotion/release annotations are required; before/after changes alone do not prove causality.

```sql
SELECT toDate(timestamp) AS day,
       count() AS views,
       countIf(empty(toString(properties.$referring_domain))) AS missing_domain,
       countIf(properties.$referring_domain = '$direct') AS direct_or_unknown,
       countIf(notEmpty(toString(properties.utm_source))) AS tagged_source,
       countIf(notEmpty(toString(properties.$session_id))) AS session_id_present
FROM events
WHERE event = '$pageview'
  AND properties.$host = 'ogabassey.com'
  AND properties.capture_mode = 'public_blog_lightweight'
  AND timestamp >= toDateTime('REPLACE_WITH_RELEASE_UTC')
  AND timestamp < toDateTime('REPLACE_WITH_END_UTC')
GROUP BY day
ORDER BY day
LIMIT 7
```

Replace both placeholders with literal UTC timestamps spanning at most seven days before running. The query is a maintainer template, not an executed receipt. Use the project's current native bot defaults explicitly documented alongside the result; a browser event filter does not establish verified-crawler access.

## Conversion contract before rates or revenue

Keep landing → product view → add to cart → checkout start → order created → payment confirmed as distinct stages. Define a privacy-safe deduplication key, retries/idempotency, payment-method coverage, web/mobile/server scope and an eligible session denominator before reporting conversion. Reconcile authorized **aggregate** payment-confirmed counts with aggregate payment reporting and explain timing/refund/duplicate differences. `order_created` is not payment; low `payment_completed` counts alone do not prove failed orders. No payment reconciliation was performed as part of this repair.

## Provider and verified-bot receipt checklist

Store dated, redacted exports or receipt references with property/account scope, UTC window, source and limitations. Do not modify provider settings or add accounts to fill an evidence gap.

| Evidence owner | Required evidence | Acceptance and limits |
| --- | --- | --- |
| GSC | Property, sitemap fetch/status, indexing reasons; representative URL Inspection crawl/render/canonical results; Product/Merchant-listing enhancements; country/device/page performance; generative-AI report availability and inclusion/inheritance setting | Preserve report dates/timezone. A missing report may mean insufficient volume. Search CTR is not AI visibility. |
| Merchant Center / OpenAI commerce | Last fetch/processing timestamps; accepted/rejected totals and reasons per destination; account/destination approval or ingestion receipt | Public feed validity/reachability alone is not provider acceptance, recommendations or approved inventory. |
| Bing Webmaster Tools | Crawl/index reports and dated AI Performance citation export with cited pages/grounding phrases | Citations, clicks and indexing are distinct; zero, unavailable and absent configuration are different states. |
| CDN / origin operators | Bounded aggregates by verified bot/IP-range attribution, path class, UTC time, status class, WAF challenge/deny and origin outcome; representative HTML/assets/robots/sitemaps | Authenticate actual Googlebot/Bingbot/OpenAI search-source traffic using provider verification. Spoofed user agents and ordinary 200 fetches do not verify crawler access. Keep search, user-triggered browsing and training agents separate. |

As of this local repair, audit 06's PostHog aggregate ingestion evidence exists. Existing authorized browser access also provided a dated private GSC receipt retained with the task artifacts for Search/AI/Discover performance, submitted sitemaps, indexing, structured-data enhancements and the homepage's indexed-state crawl/canonical outcome. It closes only those specific GSC gaps. No new production delivery, Bing/Merchant Center/OpenAI commerce receipt, verified-bot log aggregate or conversion reconciliation has been obtained here. These are unavailable evidence, not assertions that services are unconfigured. Update this ledger only when dated evidence is obtained through authorized read access.
