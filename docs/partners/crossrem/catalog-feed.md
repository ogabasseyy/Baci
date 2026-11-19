# CrossRem catalog feed v1

`GET /api/partners/v1/catalog` returns one complete JSON snapshot for the configured merchant. Send `Authorization: Bearer <token>`. Generate at least 32 random bytes and encode them as unpadded base64url for `CROSSREM_CATALOG_TOKEN` in each approved environment.

The response includes `schema_version: 1`, `currency: "NGN"` and `listings`. Each listing has the existing `listing_id`, the exact Baci product and optional variant or offer ID, title, image and product URLs, product type, brand, condition and condition label, availability and prices in kobo. Always read `condition` directly rather than inferring it from `product_url` query params (which normalize offer conditions such as `uk_used` to `used`). The `base_price_minor` field is the current Ogabassey merchandise price for the exact item. CrossRem displays `price_minor`, which is the base plus 6%, rounded to the nearest kobo. Protection and delivery are excluded from both prices. Missing brand or category data is represented by null. Legacy categories can have a label without a stable category key.

Retain the last accepted snapshot and its ETag. Send the validator with `If-None-Match`. On HTTP 304, retain the current catalog. On HTTP 200, validate the full response before replacing it. An ID missing from a complete snapshot can be deactivated. On any error, retain the previous catalog and retry according to the agreed sync schedule.

## Prepare a sandbox snapshot

1. The repository pins the Ogabassey merchant UUID and the Google listing baseline in `ogabassey-listing-bindings.json`. For a synthetic sandbox, use an isolated copy with the synthetic merchant and equivalent fixture bindings.
2. Seed `CROSSREM_CATALOG_BINDINGS` using Google Merchant's `g:id` and the exact Baci product, variant or condition offer that each entry identifies. Run the exporter with the environment's public Supabase configuration to generate candidates from the merchant's current Google feed settings. Review or exclude the unresolved IDs before seeding. Review family IDs against the exact SKU in the Google product link. Use the current public feed as the baseline and spot-check CrossRem's stored IDs before resuming sync.
3. Review the assortment and merchandise prices. Keep the ID bound to the same sellable item through price and title updates. Mark withdrawn IDs as retired and retain their binding. Add a new entry for a different sellable item.
4. Call the sandbox endpoint and check the exact listing IDs, prices and condition labels. Repeat with the returned ETag and expect 304. Remove a required fixture from the source without retiring it in the bindings and expect 503. Apply the same checks to the approved production assortment before enabling sync.

The Ogabassey baseline includes 4,501 Google listing IDs. The Riversong Vision 20S 20000mAh keeps its original ID and uses the merchant-confirmed New condition when the source condition is blank. Before resuming sync, confirm that CrossRem uses Google `g:id` as the listing key. The endpoint returns 401 for missing, invalid, or unusable credentials. After authentication, it returns 503 if bindings are missing or any active binding cannot resolve uniquely. This protects CrossRem's previous catalog from an incomplete snapshot. For a confirmed withdrawal, mark the binding retired. The next complete snapshot omits its ID and CrossRem can deactivate it. Baci caches complete snapshots internally with the same product and merchant invalidation tags as Google Merchant. Partner HTTP responses are private.


Run from the repository root. The command reads the configured merchant's public feed data and writes candidate bindings to standard output.

```sh
pnpm --dir apps/web exec tsx src/scripts/export-crossrem-catalog-bindings.ts <merchant-uuid>
```

## Verification on 19 November 2026

The feed ran through Baci's Next.js HTTP route on loopback with a temporary credential and read-only public catalog access. Requests without the credential returned 401, including conditional requests. An authenticated request returned 200 and the full snapshot. A repeat with its ETag returned 304.

All 4,501 served IDs and base prices matched the live Google Merchant feed. Each CrossRem selling price was 106% of the corresponding base price, rounded to the nearest kobo. Every listing included brand, condition, product type, availability and a false protection flag.

This check covers Baci's feed and its HTTP contract. CrossRem's own importer and sandbox access still need partner-side verification. The hosted cache headers should be checked when the sandbox endpoint is provisioned.

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


### Sandbox operator checks

- Verify that CrossRem deactivates IDs omitted from a complete 200 snapshot, retains its last catalog on 503, and reuses the previous snapshot on 304.
- Monitor authenticated error responses and the `CrossRem snapshot incomplete` warning. Use its missing count and sampled listing IDs to check the catalog, source condition, and image eligibility.
- Fix transient source failures before retrying a sync. For a confirmed withdrawal, retain the original binding with `retired: true`, review and deploy the change, then verify a 200 snapshot omits only the intended retired IDs.
