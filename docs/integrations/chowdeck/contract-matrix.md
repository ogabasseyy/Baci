# Chowdeck contract evidence

Status: **BLOCKED_CONTRACT_EVIDENCE**. This is public-document evidence, not a live provider contract or permission to connect an account.

The sanitized receipt at `packages/chowdeck-contract/evidence/0a-core/public-contract.json` was captured on 2026-11-01 from the official public documentation. Its digest is `sha256:6d738af3d8b4377a481963465c4fa5e68e9db5160f69d5e9fa92e18db4ac9c04`. It contains only bounded schema-validated structural claims, source URLs and aggregate capture metrics; it excludes raw source bodies, headers, credentials and provider examples. Nine documents were captured. The Postman reference remains quarantined and was not fetched.

| Area | Public evidence | Remaining gate |
| --- | --- | --- |
| Authentication and merchant profile | Bearer authentication and the merchant-profile GET are documented. | The account response structure and merchant identity mapping remain unproven. |
| Category and menu reads | The list and individual-item request paths are documented. | Response fields, pagination, completeness, absence and error semantics remain unproven. |
| Catalog writes | A category-create request shape is documented. | Idempotency, reconciliation, mutation responses and other write contracts are unproven; writes remain disabled. |
| Orders, fulfillment and media | Outside this capture. | No runtime or command authority is established. |

Documentation has lower precedence than an authoritative response contract and an explicitly approved disposable-account observation. Before any observation, review the account, read-only scope, fixed host, request and byte/time limits, secret input and sanitized output. The observer stops before opening a TTY or making a request while contract evidence is blocked. No provider credentials, customer data, live account requests or production changes were used for this receipt.

The currency-code snapshot in `config/iso-4217-list-one.json` is dated and pinned to the ISO 4217 Maintenance Agency's source. Re-review and refresh it before any future observer or connector is enabled; a valid code does not establish Chowdeck currency support.
