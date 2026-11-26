# Baci PostHog Reverse Proxy (Cloudflare Worker)

Offloads `/baci-relay/*` PostHog ingestion and static asset requests from Vercel CDN/Middleware to Cloudflare's global edge.

## Routing

- `/static/*` and `/array/*` → `POSTHOG_ASSETS_HOST` (default `https://eu-assets.i.posthog.com`)
- `/healthz` (`GET`) → returns `200 { "ok": true, "service": "baci-posthog-proxy" }`
- All other paths (`/i/v0/e/`, `/e/`, `/flags/`, `/decide/`, etc.) → `POSTHOG_INGEST_HOST` (default `https://eu.i.posthog.com`)

Cookies and `cf-*` headers are stripped before forwarding upstream, and `cf-connecting-ip` is forwarded as `x-forwarded-for`.

## Local Testing

```bash
node --test cloudflare-posthog-proxy/src/index.test.mjs
```

## Deployment

1. Authenticate with Cloudflare:
   ```bash
   cd cloudflare-posthog-proxy
   npx wrangler login
   ```
2. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```
3. (Recommended) Bind a custom domain in Cloudflare Workers (e.g. `posthog-proxy.usebaci.com`), then set the public environment variable in Vercel:
   ```text
   NEXT_PUBLIC_POSTHOG_RELAY_URL=https://posthog-proxy.usebaci.com
   ```
   When `NEXT_PUBLIC_POSTHOG_RELAY_URL` is unset, `apps/web` falls back to `/baci-relay` on Vercel for backwards compatibility.
