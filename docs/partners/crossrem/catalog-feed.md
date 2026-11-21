# CrossRem catalog feed v1

`GET /api/partners/v1/catalog` returns one complete JSON snapshot for the configured merchant. Send `Authorization: Bearer <token>`. Generate at least 32 random bytes and encode them as unpadded base64url for `CROSSREM_CATALOG_TOKEN` in each approved environment.

The response includes `schema_version: 1`, `currency: "NGN"` and `listings`. Each listing has the existing `listing_id`, the exact Baci product and optional variant or offer ID, title, image and product URLs, product type, brand, condition and condition label, availability and prices in kobo. Always read `condition` directly rather than inferring it from `product_url` query params (which normalize offer conditions such as `uk_used` to `used`). The `base_price_minor` field is the current Ogabassey merchandise price for the exact item. CrossRem displays `price_minor`, which is the base plus 6%, rounded to the nearest kobo. Protection and delivery are excluded from both prices. Missing brand or category data is represented by null. Legacy categories can have a label without a stable category key.

Retain the last accepted snapshot and its ETag. Send the validator with `If-None-Match`. On HTTP 304, retain the current catalog. On HTTP 200, validate the full response before replacing it. An ID missing from a complete snapshot can be deactivated. On any error, retain the previous catalog and retry according to the agreed sync schedule.

Baci checks a database revision on each authenticated poll. A cached ETag is usable only for that exact revision and deployment. An unchanged poll can return 304 without fetching the cached body or rebuilding the catalog. On a cache miss or revision change, Baci reads the current source, validates every active binding, and confirms that the revision stayed the same throughout the build. An unresolved binding, unavailable revision, or change during the rebuild returns 503. A listing price that rounds below one kobo is invalid. The rebuild returns 503 rather than silently omitting a required listing, since the importer treats an omitted listing in a complete snapshot as a removal. ETags continue to describe the exact JSON response body.

Redis shares a validated snapshot within one release. Vercel uses its deployment ID. On other hosts, inject `CROSSREM_CATALOG_CACHE_DEPLOYMENT_ID` from the deployment pipeline using an immutable build or commit ID shared by all instances. Without a configured deployment ID or available Redis lease, concurrent requests in one process share an in-flight rebuild. With Redis, one lease holder rebuilds at a time, and the lease outlasts the 60-second route limit. Concurrent requests wait up to five seconds for a new snapshot before returning 503. If the builder is terminated, its lease can block rebuilds until it expires 75 seconds after acquisition. Keep the last accepted snapshot during that window and use the agreed retry schedule. Baci publishes the ETag and compressed body together. The body budget is 8 MiB raw and 4 MiB compressed. Above either limit, Baci logs the size, stores the ETag, and rebuilds when a full response is needed. Waiting full-response requests end promptly with 503 once the builder publishes a validator without a body.

The 200 and 304 responses send `Cache-Control: private, no-cache` and `Vary: Authorization`. Private clients can retain snapshots and must revalidate them with Baci before reuse. Shared caches cannot store them. Error responses send `Cache-Control: private, no-store`.

Image verification audit fields do not advance the catalog revision. A whole-table `TRUNCATE` of a watched source is a maintenance operation that invalidates every enrolled feed, because it removes all rows from the shared table. Before a table-wide truncate, confirm that invalidating all enrolled feeds is intended. Use merchant-scoped deletes for single-merchant maintenance. Truncating merchants with cascade removes the feed enrollments. Only enrolled merchants eligible for the public feed have a readable revision. Eligibility includes published merchants and platform-admin storefronts.

## Test a snapshot with Baci fixtures

1. The repository pins the Ogabassey merchant UUID and the Google listing baseline in `ogabassey-listing-bindings.json`. For a synthetic sandbox, use an isolated copy with the synthetic merchant and equivalent fixture bindings. Register that published merchant in `crossrem_catalog_generations` after applying the migration and configure the sandbox Redis connection.
2. Seed the versioned bindings using Google Merchant's `g:id` and the exact Baci product, variant or condition offer that each entry identifies. Run the exporter with the environment's public Supabase configuration to generate candidates from the merchant's current Google feed settings. Review the exporter's `unresolved_listing_ids` before seeding and skip IDs whose identity cannot be confirmed. Review family IDs against the exact SKU in the Google product link. Use the current public feed as the baseline and spot-check CrossRem's stored IDs before resuming sync.
3. Review the assortment and merchandise prices. Keep the ID bound to the same sellable item through price and title updates. Mark withdrawn IDs as retired and retain their binding. Add a new entry for a different sellable item.
4. Call the Baci fixture endpoint and check the exact listing IDs, prices and condition labels. Repeat with the returned ETag and expect 304. Remove a required fixture from the source without retiring it in the bindings and expect 503. Apply the same checks to the approved production assortment before enabling sync.

After migrations or a restore, verify that the merchant UUID configured by the deployment has a readable revision. The initial migration enrolls Ogabassey only if its merchant row already exists. An enrolled regular merchant that is unpublished returns 503 until publication. Enrolled platform-admin storefronts follow the public feed resolver’s eligibility rule. If the route logs `CrossRem catalog enrollment or feed eligibility missing`, confirm the configured merchant exists and is eligible for the public feed. Then an authorized database operator can re-enroll that exact merchant with the following idempotent statement, replacing the placeholder with the configured merchant UUID.

```sql
INSERT INTO public.crossrem_catalog_generations (merchant_id)
SELECT id FROM public.resolve_public_feed_merchant('<configured-merchant-uuid>', false)
ON CONFLICT (merchant_id) DO NOTHING;
```

The Ogabassey baseline includes 4,501 Google listing IDs. The Riversong Vision 20S 20000mAh keeps its original ID and uses the merchant-confirmed New condition when the source condition is blank. The public Ogabassey feed used SKU-expanded mode when we validated the baseline on 19 November 2026. CrossRem stores and joins on the pinned `listing_id` from that baseline. A later Google toggle to family mode does not change a pinned ID. A family ID captured in a future migration stays bound to the exact SKU identified by its Google product link, even when Google starts showing a different representative SKU. Confirm that CrossRem's stored keys match the pinned IDs before resuming sync. The endpoint returns 401 for missing, invalid, or unusable credentials. After authentication, it returns 503 if bindings are missing or any active binding cannot resolve uniquely. This protects CrossRem's previous catalog from an incomplete snapshot. For a confirmed withdrawal, mark the binding retired. The next complete snapshot omits its ID and CrossRem can deactivate it. Partner HTTP responses are private.


The registry retains all 4,501 original IDs. Five IDs are retired after the Ogabassey catalog archived the Redmi Pad Pro 5G, Redmi Pad Pro and Redmi 15C 5G. The registry has 4,496 active listings.

For managed base products, availability follows the quantity Baci can reserve for an order. When only the legacy stock field is positive, correct the managed quantity after verifying the inventory. A legacy count alone does not make the listing available for a quote.

A valid partner credential that lacks catalog scope receives `403`. Keep the last successful snapshot when an error occurs.

Run from the repository root. The command reads the configured merchant's public feed data and writes candidate bindings to standard output.
The exporter requires SKU-expanded Google mode. It stops before reading the catalog in family mode because those Google IDs represent a different import baseline.

```sh
pnpm --dir apps/web exec tsx src/scripts/export-crossrem-catalog-bindings.ts <merchant-uuid>
```

Run the read-only live acceptance test to compare every active pinned ID, product, SKU, offer and Google condition against the public XML. The normal CI suite runs the pinned-count, uniqueness and fixture parity checks without calling the public site.

```sh
VERIFY_CROSSREM_LIVE_FEED=1 pnpm --dir apps/web exec vitest run src/app/api/partners/v1/catalog/catalog-bindings.live.test.ts
```

Rerun once after a timeout or temporary upstream error. If the public XML redirects, the test reports the status without following the redirect. Confirm the correct canonical feed URL before updating the test. Run the parity check before a Google listing mode change to record the current import IDs, then recheck it after the change to detect divergence from the pinned CrossRem IDs. For persistent listing mismatches, use the reported sample IDs to check Google listing mode, product links, verified images and condition before changing a binding.

## Verification on 19 November 2026

The feed ran through Baci's Next.js HTTP route on loopback with a temporary credential and read-only public catalog access. Requests without the credential returned 401, including conditional requests. An authenticated request returned 200 and the full snapshot. A repeat with its ETag returned 304.

Before the five retirements, all 4,501 served IDs and base prices matched the live Google Merchant feed. Each CrossRem selling price was 106% of the corresponding base price, rounded to the nearest kobo. Every listing included brand, condition, product type, availability and a false protection flag.

This check covers Baci's feed and its HTTP contract. Confirm CrossRem’s importer behavior separately. Baci can check hosted responses with its own approved credential.

### Catalog metadata corrections

Use the publisher as the brand fallback for these game listings when the product has no source brand.

| Game | Publisher and source |
| --- | --- |
| Hogwarts Legacy | [WB Games](https://www.nintendo.com/us/store/products/hogwarts-legacy-switch-2/) |
| Cyberpunk 2077: Ultimate Edition | [CD PROJEKT RED](https://ec.nintendo.com/AU/en/titles/70010000095548) |
| The Blood of Dawnwalker | [Bandai Namco Entertainment](https://store.playstation.com/en-in/concept/10013855) |
| HITMAN World of Assassination – Signature Edition | [IO Interactive](https://www.nintendo.com/au/games/nintendo-switch-2/hitman-world-of-assassination-signature-edition/) |
| The Last of Us Part I | [Sony Interactive Entertainment](https://www.playstation.com/en-us/games/the-last-of-us-part-i/) |
| Directive 8020 | [Supermassive Games](https://www.playstation.com/en-us/games/directive-8020/) |


### Operator checks before sync

- Verify that CrossRem deactivates IDs omitted from a complete 200 snapshot, retains its last catalog on 503, and reuses the previous snapshot on 304.
- Baci Commerce Operations owns the [hourly production alert](https://eu.posthog.com/project/202711/alerts?alert_type=insights&alert_id=01a1f253-1cf2-0000-3a0f-280633e9e51c) for authenticated 503s. It watches `crossrem_catalog_snapshot_unavailable` and alerts the owner when the hourly count exceeds zero. Verify receipt with a Baci-controlled alert test before enabling partner sync. The event carries the environment and no request data.
- Confirm the partner's poll interval and measure both 200 and 304 response times at that interval on the hosted Baci endpoint. Use the agreed retry schedule after 503.
- Triage from server logs. The `CrossRem snapshot incomplete` warning gives the missing count and sampled listing IDs. Check the catalog, source condition, and image eligibility against those IDs.
- For invalid prices or duplicate bindings, the projection warning identifies the affected listing ID.
- A single unresolved binding blocks snapshot replacement. If the log says `CrossRem catalog is unconfigured`, check the baseline JSON and rerun the binding tests. If partner requests return 401 and the server logs `Partner catalog credential is unconfigured`, check the deployment's credential configuration before requesting a retry.
- Fix transient source failures before retrying a sync. For a confirmed withdrawal, retain the original binding with `retired: true`, review and deploy the change, then verify a 200 snapshot omits only the intended retired IDs.
- When the last listing is deliberately retired, verify 200 with an empty listings array and confirm the importer deactivates the remaining listings.
