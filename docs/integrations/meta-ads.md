# Meta Ads reporting connector

This connector is read-only. It uses Graph/Marketing API `v25.0` and requests
only `ads_read`; it does not manage campaigns, Pixels, Conversions API, or ad
accounts. The fixed OAuth redirect URI is:

`https://usebaci.com/api/integrations/ads/meta/callback`

## Owner setup gates

Before enabling this integration, the owner must register that exact URI in
Facebook Login, provide the production app values through the server-only
environment, and complete the production App Review for `ads_read`. Because
Baci is a multi-merchant SaaS, the owner must also obtain Full Marketing API
Access Tier and confirm the Baci app's Business Verification requirement in
Meta's current dashboard. A provider-contract test against the production app
is required before the feature is exposed.

The required server-only values are `META_ADS_APP_ID`, `META_ADS_APP_SECRET`,
`META_ADS_STATE_SECRET`, and `META_ADS_TOKEN_ENCRYPTION_KEY`. Do not place
them in `NEXT_PUBLIC_` variables, browser configuration, logs, or tickets.

## Reporting semantics and release review

The connector exchanges the server-side authorization code for a long-lived
user token, validates its app/`ads_read` grant, and encrypts only that final
token. A merchant chooses an account only after it is freshly rediscovered
from paginated `/me/adaccounts`; the selected identifier must be canonical
`act_...` and is revalidated before each sync.

Daily account Insights use explicit `time_range` and `time_increment=1`.
`spend_amount_decimal` is the exact provider decimal in the account's original
currency; provider timezone/date fields are retained. Actions and action
values remain provider-labelled metadata. Meta-attributed purchase counts and
values are reporting signals, never Baci paid orders/revenue; those remain
separate attribution sources. The sync has bounded throttle retries and never
stores or returns raw provider payload/error bodies.

Release reviewers must verify: current Meta approval/access tier, callback
registration, encrypted-token RPC migration replay, response-header/error
telemetry, mixed-currency card behavior, account-access loss, expiry/reconnect
state, and a recent-window idempotent sync. Do not enable a general-availability
screen until those gates are recorded.

## Official documentation

- [Marketing API authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization)
- [Facebook Login manual flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow)
- [Long-lived user tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived)
- [Ads Insights API](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights)
- [Ad Account Insights reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/insights)
- [Marketing API rate limiting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting)
- [Marketing API changelog](https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog)
