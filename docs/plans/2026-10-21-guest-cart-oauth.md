# Guest cart OAuth continuation

## Authorized scope

Implement guest OAuth after the isolated assistant-text continuation failed across ChatGPT messages. No shopper account is required. No order or payment is authorized. Production OAuth credentials, migration provisioning and activation remain gated. PR #3752 merged; its text-continuation flag remains off in production.

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

`BACI_MCP_GUEST_OAUTH_ENABLED` defaults to `false`. Enabling requires a private worker JWT with role `mcp_guest_oauth_worker`, the trusted merchant ID and sufficient expiry; a 32-byte base64 `MCP_GUEST_OAUTH_ENCRYPTION_KEY`; and `MCP_GUEST_OAUTH_REDIRECT_URIS` containing the exact management-page redirect URI(s). These are runtime-only values, not public web variables. No values are committed. The new migration has not been applied to production by this work.

Before activation: verify RPC capability and worker tenant scope against the target database; record key backup/rotation procedures (rotating the encryption key without an old-key window requires reconnecting affected guests); verify TLS, proxy token redaction and request limits; complete actual host QA. Approval or tests do not prove publication, app-store delivery, or website deployment.

References: [OpenAI authentication contract](https://developers.openai.com/plugins/build/auth), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
