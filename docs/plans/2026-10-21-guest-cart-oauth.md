# Guest cart OAuth continuation

## Authorized scope

Implement guest OAuth after the isolated assistant-text continuation failed across ChatGPT messages. No shopper account is required. No order or payment is authorized. The owner approved OAuth storage migrations and merchant-scoped credentials for isolated QA on 22 October 2026. Production OAuth credentials and activation remain gated. PR #3752 merged; its text-continuation flag remains off in production.

## Contract

- A separate authorization-server boundary issues short-lived opaque bearer tokens following browser consent and S256 PKCE. Exact registered HTTPS redirects, issuer response identification and the exact `/mcp` resource bind the exchange. DCR supports the one configured public ChatGPT client with exact allowlisted redirects; no remote metadata fetch or wildcard redirect is permitted.
- Public catalog and current unauthenticated behavior stay unchanged while the flag is off. OAuth activation requires the canonical cart bridge; it does not fall back to the retiring legacy snapshot path. When OAuth is enabled, the MCP transport requires a verified bearer on every request. Existing connections must reconnect. This guest identity makes no claim about a shopper's email or account ownership.
- One guest grant owns a server-generated cart capability. The capability is persisted before its first cart write, so losing the first response cannot force a replacement cart. Only the verified grant resolves authority. Model inputs and outputs omit `cart_token` for connected calls. A non-secret `connection_bound` marker and canonical cart ID let the widget correlate replies without retaining authority. `get_ogabassey_guest_cart` reads current state and refreshes the five-minute signed website handoff before Review; an empty connected cart never opens an unrelated saved website cart.
- Access tokens last at most 15 minutes. Refresh tokens rotate with reuse detection. Guest grants have an absolute seven-day lifetime. Reconnecting creates a new guest grant; it does not silently attach another guest's saved web/app cart. Existing explicit handoff and merge consent remain required.
- PostgreSQL stores encrypted records behind a dedicated `mcp_guest_oauth_worker` role, scoped to its signed `merchant_id` claim. The existing guest-cart creation quota is reserved when a new guest connection is consented; token refreshes and token-bound cart updates do not consume creation budget. No service-role client, direct table grant, or browser table policy is added. AES-256-GCM authenticates the merchant and record key. Only hashed code/access/refresh handles are lookup keys. Bounded cleanup removes expired OAuth records, never commerce carts.
- Revocation denies all grant authority. OAuth setup failure is fatal before listening; invalid bearer requests receive discovery challenges. Storage failure never falls back to creating an anonymous cart.

## Implementation and verification

1. Reconcile the three already-applied facet SQL files by exact stored SQL equality; preserve original migrations and existing function definitions.
2. Implement protocol, encrypted CAS store, scoped RPCs, consent endpoints, transport verification and connected-cart registration.
3. Test replay, expiry, PKCE failure, redirect/resource substitution, refresh reuse, revocation, storage restart and tenant/key substitution. Run PostgreSQL privilege/CAS tests and multiple fresh MCP request sessions with two items and removal.
4. Run affected checks and CodeRabbit before submission. Keep a real ChatGPT connection test distinct from local protocol tests.
5. After explicit isolated infrastructure setup approval, verify actual ChatGPT OAuth reconnect and two-item removal, then website handoff and native compatibility. Stop before any order/payment submission. Production activation needs a separate approval after that evidence.

## Release inputs and acceptance gates

`BACI_MCP_GUEST_OAUTH_ENABLED` defaults to `false`. Enabling requires a private worker JWT with role `mcp_guest_oauth_worker`, the trusted merchant ID and sufficient expiry; a 32-byte base64 `MCP_GUEST_OAUTH_ENCRYPTION_KEY`; and `MCP_GUEST_OAUTH_REDIRECT_URIS` containing the exact management-page redirect URI(s). These are runtime-only values, not public web variables. No values are committed. The OAuth storage and empty-cart ownership migrations were applied to the existing database under the isolated QA authorization. Application production OAuth remains off. QA uses a separate container, encryption key, worker credential and private test apps; no orders or payments are permitted.

Before activation: verify RPC capability and worker tenant scope against the target database; record key backup/rotation procedures (rotating the encryption key without an old-key window requires reconnecting affected guests); verify TLS, proxy token redaction and request limits; complete actual host QA. Approval or tests do not prove publication, app-store delivery, or website deployment.

References: [OpenAI authentication contract](https://developers.openai.com/plugins/build/auth), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Isolated QA findings (22 October 2026)

- A live empty-cart test proved the historical legacy owner inference rejects empty ownerless rows. The OAuth worker now atomically seeds an empty row bound to its trusted merchant before canonical migration. Retries preserve items; foreign and historical ownerless handles are rejected.
- Real Chrome consent submitted `Origin: null` under `no-referrer`. Consent now uses `same-origin`, preserving the strict Origin check and suppressing cross-origin referrers. The browser reached the real ChatGPT OAuth callback and Platform discovered the authenticated tools.
- Direct live OAuth/MCP tests added two products, removed one across fresh HTTP sessions and returned only the remaining item with a fresh handoff. Actual ChatGPT conversation 6ad96388-39b8-83e9-ad52-abcd84a2b8c0 also passed: two items, remove charger (version 3→4), re-add (4→5), contextual “remove it” (5→6), then current-cart refresh. Its real handoff was connected in an empty Chrome Incognito session; the cart and guest checkout showed only the camera, quantity one. Optional save-details remained unchecked; Place Order was disabled and untouched. Native-app acceptance remains pending.

## Corrective review gates (22 October 2026)

- Apply `20261022060000_mcp_guest_oauth_gigl_request_scope.sql` before any new worker activation. It revokes existing authenticator membership and extends the installed hook without changing the GIGL, blog-media or guest-cart allowlists. It permits only POST to the four OAuth RPCs. No automatic migration restores membership.
- Run `.github/scripts/probe-guest-oauth-hook-reload.sh` against the same project. It requires a fresh five-minute unanimous fleet canary window; it never skips on recorded migration history. Only after successful evidence may the separately authorized operator restore `mcp_guest_oauth_worker` membership to `authenticator`. A failed probe leaves OAuth unavailable. Do not deploy this scope phase and silently assume the previously provisioned QA credential still works.
- `20261022060100_mcp_guest_oauth_capacity.sql` limits retained encrypted metadata to 10,000 rows per merchant, with serialized insertion admission. Existing records can still update and revoke at capacity. Cleanup frees expired rows. This bounds failed-CAS orphan indices and pre-consent records as well as normal history.
- Each grant permits at most 1,024 token generations (enough for seven days of 15-minute rotation). Refresh handles carry the grant identifier and generation authenticated with a per-grant HMAC-SHA256 key stored only inside the encrypted grant. The current hash plus that key detect authenticated replay without retaining per-refresh rows; invalid MACs cannot revoke a grant. Existing opaque QA refreshes upgrade on rotation, preserving their old indices until expiry for reuse detection. Access indices last fifteen minutes and bounded cleanup removes expired records. A 15-connection, 670-refresh-per-connection regression retains at most 45 records; the 10,000-row tenant ceiling no longer limits normal seven-day refresh history to fourteen connections.
- OAuth startup has a ten-second deadline covering merchant lookup and RPC readiness. Deliberate connected-cart reads create distinct Review operation IDs, including after a previous link was consumed.

These changes are local/PR fixes; they do not authorize applying corrective migrations, restoring membership, or activating production OAuth.
