# Social ads reporting operations

Baci supports read-only daily spend reporting for Meta Ads (Facebook and
Instagram), TikTok Ads, and Snapchat Ads. Merchant OAuth tokens stay encrypted
server-side. The analytics dashboard shows each provider's original currency,
timezone, spend, impressions, clicks (Snap calls these **Swipe Ups**), reach
when supplied, provider-attributed conversions, sync freshness, and connection
state. Provider conversions are never treated as Baci paid orders or revenue,
and spend in different currencies is never summed or used to manufacture ROAS.

## Owner activation checklist

Apply and replay all new ads migrations in the target Supabase environment
before exposing any connect button. Validate RLS/RPC behavior with an owner and
a staff account that has only the intended integration/analytics permissions.
Then configure each provider's exact callback on `https://usebaci.com`:

| Provider | Exact callback | Provider approval and server-only configuration |
| --- | --- | --- |
| Meta Ads | `https://usebaci.com/api/integrations/ads/meta/callback` | Complete `ads_read` App Review, Full Marketing API Access Tier, and the Business Verification requirement shown in the live Meta dashboard. Configure `META_ADS_APP_ID`, `META_ADS_APP_SECRET`, `META_ADS_STATE_SECRET`, and `META_ADS_TOKEN_ENCRYPTION_KEY`. |
| TikTok Ads | `https://usebaci.com/api/integrations/ads/tiktok/callback` | Obtain TikTok For Business app approval and scopes `100` and `44`. Configure `TIKTOK_ADS_APP_ID`, `TIKTOK_ADS_APP_SECRET`, `TIKTOK_ADS_AUTHORIZATION_URL`, `TIKTOK_ADS_STATE_SECRET`, and `TIKTOK_ADS_TOKEN_ENCRYPTION_KEY`. Set `TIKTOK_ADS_STATE_ECHO_VERIFIED=true` only after a sandbox proves exact state echo. |
| Snapchat Ads | `https://usebaci.com/api/integrations/ads/snapchat/callback` | Create the OAuth app as a Snapchat Business Manager Organization Admin and complete Snap's current Marketing API activation flow. Configure `SNAPCHAT_ADS_CLIENT_ID`, `SNAPCHAT_ADS_CLIENT_SECRET`, `SNAPCHAT_ADS_STATE_SECRET`, and `SNAPCHAT_ADS_TOKEN_ENCRYPTION_KEY`. |

Do not put any of these values in `NEXT_PUBLIC_` variables, logs, tickets, or
browser configuration. Ordinary advertiser reporting does not require a
creator or social-media commercial partnership, but provider developer-app
approval and access review still apply.

## Release and incident checks

Before production enablement, complete a live-provider test for consent denial,
callback replay/expiry, account discovery and selection, recent-window sync,
revoked access, rate limiting, currency/timezone accuracy, and idempotent
resync. Meta long-lived user tokens require reconnect before expiry. TikTok and
Snap currently use conservative process-local rate gates; multi-instance
production enablement requires a shared queue/limiter. Snap's confidential web
flow deliberately omits PKCE until official sandbox support is confirmed.

If the dashboard shows **Needs attention**, reconnect the provider. If it shows
**stale**, run **Sync now**. A connected account with no metrics needs an
account selection or its first sync. Reporting failures do not remove Baci's
existing click-ID/order attribution (`fbclid`, `ttclid`, `gclid`, `sccid`).

Provider-specific implementation notes and official sources are maintained in
[Meta Ads](../integrations/meta-ads.md),
[TikTok Ads](../integrations/tiktok-ads.md), and
[Snapchat Ads](./SNAPCHAT_ADS_INTEGRATION.md).
