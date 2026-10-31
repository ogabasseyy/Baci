# ACP 2026-04-17 fixtures

Baci-authored request and response examples for creating an Agentic Commerce
Protocol checkout session. They are written for Baci's tests, not copied from
the ACP repository, and they invent no credentials: `Authorization` is
`Bearer REDACTED`.

| | |
| --- | --- |
| Repository | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol |
| Release commit | `9abf303f48088d170503a54502d612b8b1997897` ("RELEASE: 2026-04-17", 17 April 2026) |
| Licence of the specification | Apache-2.0 |
| Checked | 31 October 2026 |

## What the fixtures follow

- `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`, operation
  `createCheckoutSession`:
  - `Idempotency-Key` and `API-Version` are required headers.
  - `CheckoutSessionCreateRequest` requires `line_items`, `currency` and
    `capabilities`.
  - A created session answers `201` with `CheckoutSession`, which requires
    `id`, `status`, `currency`, `line_items`, `totals`, `fulfillment_options`,
    `messages`, `links` and `capabilities`.
  - `LineItem` requires `id`, `item`, `quantity` and `totals`; `Total`
    requires `type`, `display_text` and an integer minor-unit `amount`.
- `spec/2026-04-17/json-schema/schema.agentic_checkout.json`, the same shapes
  as JSON Schema. The fixtures were checked against it once when written.
- The currency is lower case (`ngn`), like the specification's own examples.

The OpenAPI path examples still show `items` in the create request body, which
the schema does not allow. The schema and the required list above decide.

## Files

- `create-checkout-session.request.json`: request headers and body.
- `create-checkout-session.response.json`: response status, headers and body.

`acp-fixtures.test.ts` checks the required fields above. It also records one
known gap as an `it.fails` test: Baci advertises ACP version `2026-04-30`,
which has no release (F41). The released versions in the test are the spec
directories of the commit above: `2025-09-29`, `2025-12-12`, `2026-01-16`,
`2026-01-30` and `2026-04-17`.
