# Device identity, catalog images and analytics

Successful checks normalize the provider's device description into brand, model,
colour and storage. Unsupported or absent fields remain unknown. Numeric device
identifiers are excluded from model normalization. The normalized profile is
stored in the existing lookup's cached response, including asynchronous Petrock
completion. Polling and replaying that response do not create additional rows.

## Catalog images

Matching uses the lookup merchant's active public products and the existing
`get_storefront_product_variants` safe projection, through an anonymous client.
Model and brand must match exactly after normalization. When colour is known,
only an image from a matching colour variant is used. Another storage capacity's
image may illustrate the same colour chassis. Unknown colour can use a model
illustration with a visible colour disclaimer. No confident match, invalid image
URL or catalog failure leaves the default device icon; provider success survives.

A read-only public catalog probe matched the provider-observed iPhone 17 Pro Max,
Silver, 512GB configuration to Ogabassey's Silver catalog image (HTTP 200, AVIF).
This probe did not submit another provider order or write a customer lookup.

## Admin analytics

The admin analytics page includes an Ogabassey IMEI panel for the selected period.
The normal authenticated API requires `analytics.read`; the SQL function also
checks that permission independently. The response contains aggregate counts,
never raw identifiers, identifier hashes, customer identities or provider reports.

- Requests count durable lookup rows created within the selected date window.
- Completed checks count completed rows, including repeat checks in other tiers.
- Distinct device IDs deduplicate the merchant and stored identifier hash. These
  are identifiers, not necessarily physical devices: one phone can have two IMEIs.
- Model, brand, colour/storage and service rankings use completed rows only.
- Historical responses without a normalized model count as unidentified.
- Matching failures do not exclude an otherwise identified device from analytics.

The new migration `20261025130000_imei_device_analytics.sql` must be applied with
the application release. It has not been applied to production. Existing lookup
retention controls the history available; this change adds no separate event log.

## Verification

Colocated tests cover normalization, colour selection, safe catalog reads,
completion persistence, API permission failures and dashboard error/retry states.
SQL tests run against an isolated empty local PostgreSQL database using
`supabase/tests/fixtures/imei_device_analytics.sql`, followed by the migration and
`supabase/tests/imei_device_analytics.sql`. Never run the fixture against a shared
or production database. Assertions cover tenant filtering, permission denial,
case-insensitive grouping, distinct counts, date windows and replay behavior.

Image containers retain their existing dimensions. No client analytics SDK or
additional storefront page-load request was added. Production CWV remains a
separate deployment verification step.
