# UCP 2026-04-08 JSON Schemas

Vendored copies of the Universal Commerce Protocol JSON Schemas that Baci's
offline conformance tests validate against. They are Apache-2.0 licensed; the
upstream licence is in `LICENSE`.

| | |
| --- | --- |
| Repository | https://github.com/Universal-Commerce-Protocol/ucp |
| Commit | `9c9d6fce39ffa8bf7cb66309c378b79fb75b5382` |
| Branch | `release/2026-04-08` (its head when retrieved; committed 22 October 2026) |
| Upstream directory | `source/` (paths below are relative to it) |
| Retrieved | 31 October 2026 |
| Licence | Apache-2.0 |

## Why a commit and not a tag

The `v2026-04-08` tag was re-cut on 22 October 2026. A tag can move again, so
this directory pins the commit. To update it, choose a new commit on purpose,
re-fetch every file below, regenerate `manifest.json` from the unformatted
downloads, and rerun the tests.

## Integrity

`manifest.json` holds the SHA-256 of `JSON.stringify(JSON.parse(bytes))` for
each file. Biome formats these JSON files, so their whitespace differs from
upstream, but the parsed content and therefore the hash do not. The tests in
`ucp-schema-validator.test.ts` check every hash, that no schema file is missing
or extra, and that every relative `$ref` reachable from the six root schemas
resolves to a file in this directory.

## Roots

- `discovery/profile_schema.json`
- `schemas/ucp.json`
- `schemas/shopping/catalog_search.json`
- `schemas/shopping/catalog_lookup.json`
- `schemas/shopping/cart.json`
- `schemas/shopping/order.json`

The catalog roots hold their request and response schemas under `$defs`;
callers validate against `#/$defs/search_response` and
`#/$defs/lookup_response`.

## How the validator uses them

`ucp-schema-validator.ts` loads these files only; it never fetches anything. It
registers each schema under its `$id` and makes two adaptations in code, not in
the files:

- The discovery profile declares an `$id` one directory deeper than its own
  `$ref` paths assume, so it is registered under a matching base URI.
- `ucp_request` (per-operation request presence rules) and the capability
  schemas' root `name` are accepted as annotations and ignored, because the
  validator checks response payloads only.

## Files (61)

- `discovery/profile_schema.json`
- `schemas/capability.json`
- `schemas/payment_handler.json`
- `schemas/service.json`
- `schemas/shopping/cart.json`
- `schemas/shopping/catalog_lookup.json`
- `schemas/shopping/catalog_search.json`
- `schemas/shopping/checkout.json`
- `schemas/shopping/order.json`
- `schemas/shopping/payment.json`
- `schemas/shopping/types/adjustment.json`
- `schemas/shopping/types/amount.json`
- `schemas/shopping/types/attribution.json`
- `schemas/shopping/types/available_payment_instrument.json`
- `schemas/shopping/types/buyer.json`
- `schemas/shopping/types/category.json`
- `schemas/shopping/types/context.json`
- `schemas/shopping/types/description.json`
- `schemas/shopping/types/detail_option_value.json`
- `schemas/shopping/types/error_code.json`
- `schemas/shopping/types/expectation.json`
- `schemas/shopping/types/fulfillment_event.json`
- `schemas/shopping/types/info_code.json`
- `schemas/shopping/types/input_correlation.json`
- `schemas/shopping/types/item.json`
- `schemas/shopping/types/line_item.json`
- `schemas/shopping/types/link.json`
- `schemas/shopping/types/media.json`
- `schemas/shopping/types/media_external_video.json`
- `schemas/shopping/types/media_image.json`
- `schemas/shopping/types/media_model_3d.json`
- `schemas/shopping/types/media_source.json`
- `schemas/shopping/types/media_video.json`
- `schemas/shopping/types/message.json`
- `schemas/shopping/types/message_error.json`
- `schemas/shopping/types/message_info.json`
- `schemas/shopping/types/message_warning.json`
- `schemas/shopping/types/option_value.json`
- `schemas/shopping/types/order_confirmation.json`
- `schemas/shopping/types/order_line_item.json`
- `schemas/shopping/types/pagination.json`
- `schemas/shopping/types/payment_credential.json`
- `schemas/shopping/types/payment_instrument.json`
- `schemas/shopping/types/postal_address.json`
- `schemas/shopping/types/price.json`
- `schemas/shopping/types/price_filter.json`
- `schemas/shopping/types/price_range.json`
- `schemas/shopping/types/product.json`
- `schemas/shopping/types/product_option.json`
- `schemas/shopping/types/rating.json`
- `schemas/shopping/types/reverse_domain_name.json`
- `schemas/shopping/types/search_filters.json`
- `schemas/shopping/types/selected_option.json`
- `schemas/shopping/types/signals.json`
- `schemas/shopping/types/signed_amount.json`
- `schemas/shopping/types/total.json`
- `schemas/shopping/types/totals.json`
- `schemas/shopping/types/variant.json`
- `schemas/shopping/types/warning_code.json`
- `schemas/transports/embedded_config.json`
- `schemas/ucp.json`
