# TikTok Ads reporting connector

The Baci TikTok Ads connector is read-only Marketing API reporting. It is pinned to `/open_api/v1.3/` and stores a selected advertiser's account-local daily Basic (`AUCTION_ADVERTISER`) report. Spend remains the exact provider decimal in the advertiser's returned currency; conversions are explicitly TikTok optimization-event conversions, not Baci orders or revenue.

## Owner gates before enabling

1. Obtain TikTok For Business developer-app approval and request only scope IDs `100` (Read Ad Account Information) and `44` (Consolidated Report).
2. Configure the exact registered callback: `https://usebaci.com/api/integrations/ads/tiktok/callback`.
3. In a TikTok sandbox, verify that the approved advertiser authorization URL echoes Baci's `state` unchanged. Set `TIKTOK_ADS_STATE_ECHO_VERIFIED=true` only after that evidence exists. The connector deliberately refuses cookie-only OAuth correlation.
4. Validate denial, replayed/expired code, revoked access token, account discovery, opaque advertiser selection, currency/timezone, and a throttled report before production activation.

## Operational limits

Normal syncs are inclusive 30-day account-local chunks, one selected advertiser at a time. Account discovery enriches missing currency/timezone fields through the v1.3 advertiser-info endpoint and excludes any advertiser that still lacks both values before it can be selected. The v1.3 report explicitly requests `advertiser_id` plus `stat_time_day`; the parser accepts the freshly rediscovered authorized advertiser/currency/timezone only as a strict fallback and rejects every nonempty partial/malformed page rather than marking a zero-row success. TikTok's regular metrics can lag roughly 30 minutes to two hours; reach can be delayed around 16 hours and TikTok applies a daily correction at 12:00 UTC. `40100`, HTTP throttles, and `X-Tt-Ads-Throttle` cause bounded jittered exponential backoff; a truncated result is not recorded as success. A conservative per-process gate serializes requests at 8 QPS / 480 QPM and rejects a full in-memory queue. It is intentionally not a distributed queue: multi-instance enablement requires a durable global limiter. Async task status is parsed only for a future exceptional-volume workflow; dashboard requests never poll a task synchronously.

Official sources: [Marketing API authorization](https://business-api.tiktok.com/portal/docs?id=1738373141733378), [authentication](https://business-api.tiktok.com/portal/docs?id=1738373164380162), [authorized advertisers](https://business-api.tiktok.com/portal/docs?id=1738455508553729), [synchronous reporting](https://business-api.tiktok.com/portal/docs?id=1740302848100353), [async reporting](https://business-api.tiktok.com/portal/docs?id=1738864800380930), [report latency](https://business-api.tiktok.com/portal/docs?id=1738864894606337), [rate limits](https://business-api.tiktok.com/portal/docs?id=1740029171730433), and [currency precision](https://business-api.tiktok.com/portal/docs?id=1772544628718594).
