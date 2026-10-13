# Google Ads reporting integration

Baci stores one Google Ads connection per merchant and reads daily reporting
snapshots from `merchant_ad_spend_daily`. OAuth grants are encrypted before they
are persisted in `merchant_ad_connections`; no access or refresh token is
returned by the status or spend endpoints.

## Production environment variables

Set these as server-only deployment secrets (never `NEXT_PUBLIC_*`):

- `GOOGLE_ADS_OAUTH_CLIENT_ID` — the dedicated Baci web OAuth client ID.
- `GOOGLE_ADS_OAUTH_CLIENT_SECRET` — the matching client secret.
- `GOOGLE_ADS_STATE_SECRET` — a random high-entropy secret used to sign OAuth state.
- `GOOGLE_ADS_TOKEN_ENCRYPTION_KEY` — a 32-byte key encoded as base64url (or 64 hex characters) for AES-256-GCM token encryption.
- `GOOGLE_ADS_OAUTH_REDIRECT_URI` — optional; defaults to
  `https://usebaci.com/api/integrations/ads/google/callback` and must remain
  that exact HTTPS `usebaci.com` callback (no query string or alternate host).
- `GOOGLE_ADS_API_VERSION` — optional API major version (defaults to the current
  `v25`; change only after checking Google's release/sunset schedule).

The Google Cloud OAuth client must allow that exact redirect URI. The Google Ads
API Center developer token and access level are separate from merchant OAuth;
the reporting worker will need those credentials before it can populate daily
spend rows.

## Routes

- `GET /api/integrations/ads/google/connect` starts an authenticated,
  merchant-bound PKCE flow.
- `GET /api/integrations/ads/google/callback` verifies state, exchanges the
  code, encrypts the grants, and upserts the merchant connection.
- `GET /api/integrations/ads/google/status` returns connection metadata only.
- `GET /api/integrations/ads/google/accounts` discovers accounts after OAuth
  (requires integration-management access); `PATCH` selects a discovered
  customer ID and validates it against Google's response.
  Manager hierarchies are traversed within bounded manager-node, depth, and
  customer limits. If a bound leaves manager work unvisited, discovery fails
  with a retryable limit error rather than returning a partial account list.
- `POST` or `DELETE /api/integrations/ads/google/disconnect` removes the
  connection (web requests require the normal CSRF header).
- `GET /api/integrations/ads/google/spend?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
  returns tenant-scoped daily spend snapshots. A customer ID can be supplied
  as `customerId=123-456-7890`.
- `POST /api/integrations/ads/google/sync` performs a CSRF-protected,
  merchant-authenticated on-demand sync for a range of at most 90 days.

The sync path is intentionally not part of the OAuth callback. It uses the
encrypted refresh grant only on the server, calls Google Ads reporting, and
upserts normalized daily rows through permission-checked database RPCs. No
encrypted grant columns are selectable by the authenticated PostgREST role.
