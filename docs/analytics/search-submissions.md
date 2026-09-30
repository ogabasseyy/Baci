# Storefront search submission analytics

Issue [#3564](https://github.com/ogabasseyy/Baci/issues/3564) separates an explicit search submission from a results-page read. This implementation starts from main; the broader browse journey in open PR #3547 is a separate change. Main lacked the results-page form and autocomplete see-all link, so this change adds these controls without bringing in that PR's pagination or mobile work.

| Entry | Event boundary | Navigation |
| --- | --- | --- |
| Ogabassey navbar, before and after lazy autocomplete loads | Form submit | Existing router navigation |
| Results page | Form submit using the current `q` field | Native GET form |
| Autocomplete see-all | Link activation using the current typed query | Native search link |
| Did-you-mean | Suggested-query link activation | Native search link |

`searchStorefrontProducts`, candidate collection, `/api/search` GET and the server-rendered search page are read-only. Rendering, metadata, framework prefetch, hover, reload, back/forward restore, pagination URLs, bookmarks, shared links, and typed results URLs cannot write `search_analytics`. Re-submitting the same query intentionally records another submission. Product selection and blog search retain their existing navigation and do not record product-search submissions. Autocomplete's existing `trackEvent.search` belongs to the separate merchant event stream and remains unchanged.

The forms retain `method="get"`, their store-specific search action and the `q` field. Links retain real search hrefs and use plain anchors, so spelling suggestions cannot trigger framework prefetch analytics. Search works before hydration and without JavaScript. Those unobservable submissions deliberately **do not count**: introducing a query-string tracking flag would let reloads or shared URLs inflate the count again. Analytics-disabled browsers and failed delivery also undercount; the metric represents observed explicit submissions, not all searches or visits.

The client starts a small JSON POST to `/api/search/submissions` with `keepalive: true` before navigation. It never waits, retries, or blocks search on failure or throttling. `source` is validated as one of the five entry points (navbar, results-form, see-all, did-you-mean, popular-search); the existing table schema stores the query, merchant, server-derived count and `search_method: 'client'`, without adding a source column.

The public endpoint requires the exact same Origin as the request host and protocol, rejects malformed/oversized input, ignores missing or known bot/tool user agents, and resolves the published storefront through the existing merchant snapshot lookup. Custom domains and storefront subdomains resolve from the host; platform/preview/path-based stores resolve from the validated path prefix. It ignores a body-selected store on custom domains. It derives the count with a bounded first-page search RPC (one row, no spelling lookup), then inserts through the normal server Supabase client under RLS. No privileged client or new database policy is involved.

The existing proxy applies a dedicated budget of **20 requests per IP per minute** for `/api/search/submissions`, isolated from autocomplete and result reads. It uses the shared Redis sliding-window limiter, with the repository's per-instance memory fallback when Redis is unavailable. Throttling may lose analytics behind shared NAT but cannot stop result navigation. This is request-volume protection, not query deduplication or proof of human activity: clients can spoof user agents and Origin, and the existing public table INSERT policy remains outside the HTTP limiter. Strong abuse resistance would require a separate database ingestion-policy change; this fix does not claim to provide it.

Focused tests exercise both loader branches without analytics, cold and loaded navbar submission, intentional identical resubmission, preserved Enter-to-product behavior, both native link events, the results form, zero-result counts, host identity, safe error handling, invalid input/origins, known bots, and rate-limit exhaustion/recovery without consuming autocomplete's budget.
