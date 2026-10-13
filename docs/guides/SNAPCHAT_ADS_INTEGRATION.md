# Snapchat Ads reporting connector

This is a read-only Snapchat Marketing API reporting connection. It uses the user OAuth authorization-code flow with only `snapchat-marketing-api`, discovers the connected user's organizations and active ad accounts, and persists daily account totals through the provider-neutral ads RPCs. It does not create campaigns, change billing, send offline conversions, access Public Profile APIs, or expose credentials to browsers.

## Before enabling

An owner must complete and record these gates:

1. Create the OAuth application in Snapchat Business Manager as an Organization Admin, accept the applicable Snap terms, register exactly `https://usebaci.com/api/integrations/ads/snapchat/callback`, and retain the client secret only in server configuration.
2. Complete or verify Snap's current Marketing API activation path with a non-sensitive sandbox/API smoke test. The Marketing API landing page says it is open to developers but directs applicants to activation; the exact activation criteria were not verifiable from the official page at implementation time.
3. Confirm the authorizing identity has only the needed reporting permissions (prefer ad-account `reports` / narrowly assigned Data Admin access). Creating the OAuth app requires Organization Admin, but normal reporting need not use that broad role.
4. Confirm in the live sandbox whether Snap supports PKCE for this confidential web app. This connector deliberately sends no PKCE parameters until it is verified; it does use signed short-lived provider/merchant/user/callback-bound state and an HttpOnly state cookie.

There is no discovered commercial or creator-partnership prerequisite for ordinary advertiser reporting. Creator partnership requirements apply to creator workflows, and the Public Profile API's allowlist/scope is out of scope.

## Reporting behavior

- API root: `https://adsapi.snapchat.com/v1`.
- Discovery: `GET /me/organizations?with_ad_accounts=true`; server re-discovers before accepting an account selection.
- Stats: account-level `DAY` rows use local-midnight boundaries in the selected account's IANA timezone, including DST 23/25-hour days.
- Spend remains an exact integer micro-currency value; only a string decimal display value is derived.
- `swipes` is stored in normalized `clicks` but labelled **Swipe Ups**. `conversion_purchases` is labelled **Snapchat-attributed purchases** and is never treated as Baci order revenue.
- V1 daily-account sync is intentionally synchronous-only. A `report_run_id` response fails closed with a stable unsupported-report error; Baci does not follow provider-signed report URLs or retain raw CSV/Excel data until that separate async ingestion flow is designed and reviewed.
- Disconnect revokes only the Snapchat connection; historical spend snapshots remain available for analytics and are not erased as part of credential cleanup.
- Requests are serialized below the documented per-token limit; 429/5xx get bounded retries. 401/403 marks the stored connection reconnect-required rather than retrying indefinitely.

Official references (retrieved 2026-08-21): [Marketing API home](https://developers.snap.com/marketing-api/home), [OAuth](https://developers.snap.com/marketing-api/Ads-API/authentication), [Quick Start](https://developers.snap.com/marketing-api/Ads-API/quick-start), [Organizations](https://developers.snap.com/marketing-api/Ads-API/organizations), [Ad Accounts](https://developers.snap.com/marketing-api/Ads-API/ad-accounts), [Measurement](https://developers.snap.com/marketing-api/Ads-API/measurement), [Rate limits](https://developers.snap.com/marketing-api/Ads-API/rate-limits), [Roles](https://developers.snap.com/marketing-api/Ads-API/roles), and [OAuth FAQ](https://developers.snap.com/marketing-api/Ads-API/faq).

The current limiter is process-local and deliberately conservative, but it does not coordinate multiple serverless instances against Snap's app-wide quota. Before production enablement, an owner must add or designate a shared queue/limiter and cap connector concurrency accordingly.
