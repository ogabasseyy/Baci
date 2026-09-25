# Jumia Self Authorization Connection Design

## Objective

Provide a reliable fallback for Jumia sellers while Jumia's automatic OAuth
flow returns a roughly 24-hour access token without a refresh token. A merchant
connects with the client ID and refresh token from their own Jumia Vendor Center
Self Authorization application, then chooses which discovered shops Baci may
connect.

The dashboard continues to describe Jumia as a sales channel. "Connection" is
used only for the technical status and setup actions inside that channel.

## User Flow

1. The merchant opens Dashboard > Sales channels > Jumia.
2. Baci presents two methods:
   - Connect automatically with Jumia.
   - Connect with Self Authorization.
3. The manual method explains how to create a Self Authorization application in
   Jumia Vendor Center under Settings > Applications.
4. The merchant enters only the application's client ID and refresh token.
5. Baci exchanges that refresh token with the matching client ID and retrieves
   the seller's Jumia shops.
6. Baci displays all discovered shops as an explicit checkbox list. No shop is
   preselected.
7. Shops that are already connected are marked and disabled.
8. The merchant selects one or more new shops and chooses "Connect selected
   shops".
9. Baci creates one marketplace integration per selected shop and refreshes the
   Sales channels page.

If validation fails or Jumia returns no shops, Baci persists nothing.

## Credential and Data Model

One Self Authorization grant can cover multiple shops. Credential state is
stored once and referenced by every selected shop; it is never copied into each
integration row because refresh-token rotation would leave stale sibling rows.

The shared authorization requires:

- Merchant-specific Self Authorization client ID.
- Refresh token and current access token.
- Access-token expiry timestamp.
- Connection method set to `self_authorization`.

Each selected shop integration requires:

- A reference to the shared authorization.
- Discovered Jumia shop ID, name, country, and marketplace metadata.

The self-authorization client ID remains coupled to the refresh token because
future refresh requests must use the same client ID that issued it.
Automatic OAuth integrations continue to use Baci's configured OAuth client ID.

A new append-only migration creates a merchant-scoped Jumia authorization table
and adds an optional authorization reference plus connection method to shop
integrations. Authorization credentials are stored as AES-256-GCM authenticated
ciphertext under a dedicated server-only key. Existing automatic OAuth rows
remain `oauth` and continue using their existing token columns.

## Server Architecture

The current token-only POST behavior is replaced with a two-step server flow.
The merchant-entered credentials remain only in the dialog's in-memory form
state between the two requests and are cleared when the dialog closes or the
connection succeeds. This avoids introducing privileged credential-staging
storage or returning credentials from the server.

### Credential validation and shop discovery

A protected, CSRF-validated endpoint accepts a Zod-validated client ID and
refresh token. Before any integration write, it:

1. Exchanges the refresh token at Jumia's token endpoint with the supplied
   client ID.
2. Validates the token response schema.
3. Uses the returned access token to fetch the authenticated seller's shops.
4. Returns only safe shop metadata and an indication of which shops are already
   connected.

The browser response never contains the submitted refresh token, returned
access token, or provider error details that could contain credentials.

### Selected-shop persistence

A second protected, CSRF-validated endpoint accepts the client ID and refresh
token again plus a non-empty array of selected discovered shop IDs. The server
repeats the token exchange and shop discovery so it never trusts the browser's
earlier discovery result. It rejects IDs absent from the fresh discovery result
and persists the shared encrypted authorization plus selected shop integrations
through one transactional database function. The function is callable by
`authenticated`, derives merchant and integration-management authority from
`auth.uid()`, accepts ciphertext rather than plaintext credentials, and returns
safe identifiers only.

Existing integrations for the merchant and shop are returned as already
connected rather than duplicated. Partial persistence is not allowed: either
all selected shops are saved or none are.

## Token Refresh

`JumiaClient` loads the integration's connection method. For Self Authorization
it decrypts the referenced shared authorization, refreshes using its client ID,
and compare-and-swap rotates that shared grant once for all referenced shops.
For automatic OAuth it uses Baci's configured OAuth client ID and existing
per-integration tokens.

Refresh-token rotation remains supported: when Jumia returns a replacement
refresh token, Baci stores it with the new access token and expiry. Missing or
invalid client configuration produces a safe actionable sync error rather than
falling back to an unrelated global client ID.

## Security and Logging

- Authentication precedes protected database access.
- Zod validation precedes every database write.
- Client IDs and tokens never appear in URLs, client logs, server logs,
  analytics, errors, or response bodies after submission.
- Provider errors are sanitized before logging or returning a generic message.
- Self Authorization credentials are retained only in transient dialog memory
  until the selected shops are persisted, then cleared.
- Database reads and writes use the authenticated scoped Supabase client and
  explicit column lists.
- Credentials are never exposed again through connection-status APIs.
- Missing keys, malformed ciphertext, and failed authentication tags fail
  closed.

## Product Publishing and Sync Experience

Once a shop is connected, merchants can continue exporting a single product or
open a new multi-product "Sync products" flow:

1. Open Dashboard > Sales channels > Jumia and choose "Sync products", or use
   the existing "Export to Jumia" action on one product.
2. Choose exactly one connected Jumia shop as the destination.
3. Filter the Baci catalog using independent controls:
   - Baci category, including nested categories such as Gaming.
   - Product condition, such as Brand new, Open box, or Used.
   - Optional brand, publication status, stock availability, and text search.
4. Review the filtered results and explicitly select products. Nothing is
   selected initially. "Select all" selects only the currently visible filtered
   results, never the merchant's entire unseen catalog.
5. Assign the required Jumia category and brand. A merchant may apply one Jumia
   category or brand to all compatible selected products, then override either
   value per product. Products missing required Jumia classification remain
   blocked and are not submitted.
6. Review a readiness summary showing ready, already mapped, and blocked
   products, then publish the ready selection.
7. Baci submits bounded product-feed batches and records a pending
   product/variant-to-integration mapping plus feed identifier for every
   submitted seller SKU.

Baci initially shows submitted products as pending because Jumia processes feeds
asynchronously. A feed reconciler reads the feed items, matches seller SKU plus
integration, and marks each mapping synced or failed with a safe error summary.
Mixed feed results leave successful mappings synced and failed mappings
independently retryable.
Already mapped products are disabled in the initial-publish list and instead
offer update or resync actions.

### Ongoing synchronization

Initial publishing and ongoing synchronization are distinct:

- Initial publishing creates the product on the selected Jumia shop.
- Inventory sync pushes changed stock for successfully mapped products when the
  merchant chooses "Sync stock". Existing batch stock behavior is preserved.
- Price and status updates continue to be pushed from the mapped product's Jumia
  settings when the merchant saves changes.
- The UI must not describe `sync_inventory` or `sync_price` as automatic until a
  durable worker or outbox actually processes product changes. In this phase
  those controls are labelled as update preferences and all pushes are
  explicitly initiated.

Automatic event-driven or scheduled price and inventory propagation is a
separate follow-up. It requires a durable, retryable outbox/worker rather than
relying on settings flags alone.

## Error Handling

- Invalid client ID or refresh token: generic credential-validation error; no
  persistence.
- No discovered shops: explain that Jumia returned no seller shops; no
  persistence.
- Selection contains an undiscovered shop: reject the complete request.
- Already-connected shop: display it as disabled during selection.
- Jumia timeout or unavailable service: retry-safe error; no persistence.
- Database failure: rollback all selected-shop writes and preserve prior
  integrations.
- Feed accepted but pending-mapping persistence fails: return the feed ID as
  reconciliation-required and never claim that products are tracked or synced.

## Testing

- Schema tests for credentials and selected shop IDs.
- Token exchange tests proving the supplied client ID is forwarded and secrets
  are sanitized from errors and logs.
- Discovery endpoint tests for authentication, CSRF, validation, success, no
  shops, provider failure, and zero persistence.
- Persistence endpoint tests for repeated credential validation, invalid shop
  IDs, duplicate shops, multi-shop success, and atomic database failure.
- Credential-crypto tests for round trips, fresh nonces, wrong keys, tampering,
  and missing configuration.
- Database tests for merchant derivation, staff permission, transactional
  authorization/shop persistence, and cross-merchant denial.
- `JumiaClient` concurrency tests proving multiple shops share and safely rotate
  one authorization while OAuth retains the configured platform client ID.
- Dialog tests for the two-step form, no default selections, already-connected
  shops, multiple selection, loading, and error states.
- Product-selection tests for independent category and condition filters,
  combined filters, pagination, empty results, explicit selection, and
  visible-results-only select all.
- Classification tests for bulk category/brand application, per-product
  overrides, incompatible selections, and blocked incomplete products.
- Product publishing tests for shop ownership, mapping identity, bounded
  batches, pending persistence, asynchronous reconciliation, mixed feed results,
  retry, and safe errors.
- Regression coverage confirming the existing single-product export and manual
  stock, price, and status update paths remain available.

## Out of Scope

- Sharing one Self Authorization client ID among unrelated merchants.
- Replacing the automatic OAuth flow.
- Automatic background price or inventory synchronization.
- Changing Jumia's feed-processing behavior.
