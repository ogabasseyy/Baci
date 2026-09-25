# Ogabassey ChatGPT MCP Server

This MCP (Model Context Protocol) server enables ChatGPT integration with the Ogabassey store, allowing customers to:

- Search products
- Get product details
- Check order status
- Get store information
- Receive product recommendations

## Quick Start

### Option 1: Docker (Recommended)

```bash
# From the repository root
cd apps/web/mcp-server

# Build and run
docker compose up -d

# Check logs
docker compose logs -f
```

The server will be available at `http://localhost:8787/mcp`

### Option 2: pnpm

```bash
# From the project root
pnpm --filter @baci/web mcp
```

## Exposing to the Internet

### For Development (ngrok)

```bash
# With Docker
docker compose --profile dev up -d

# Or manually
ngrok http 8787
```

### For Production

Production runs Docker Compose behind a reverse proxy. The compose file binds
MCP to `127.0.0.1:8787`, so nginx/traefik should be the public TLS entrypoint.
The production VPS keeps secrets in a private `.env` file outside git; pass its
path as `MCP_REMOTE_ENV_FILE=<PROD_ENV_PATH>`. The repo deploy script copies
that file into the release as `apps/web/mcp-server/.env` before building the
container.

```bash
# From the repository root

# Preview the source bundle without touching the VPS
MCP_DRY_RUN=1 MCP_VPS_HOST=<VPS_HOST> MCP_VPS_USER=<VPS_USER> .github/scripts/deploy-mcp-server.sh

# Deploy the current checkout
MCP_VPS_HOST=<VPS_HOST> MCP_VPS_USER=<VPS_USER> .github/scripts/deploy-mcp-server.sh
```

Provide the real host, user, remote directory, and env path through private
operator config or CI secrets (`MCP_VPS_HOST`, `MCP_VPS_USER`, optional
`MCP_REMOTE_DIR`, optional `MCP_REMOTE_ENV_FILE`, optional
`MCP_RELEASE_KEEP_COUNT`, default `5`). The script packages the MCP application
source, web build inputs, dependency manifests (not installed `node_modules`),
and optional patches, uploads them to
`<MCP_REMOTE_DIR>/releases/<release-id>`, runs
`docker compose -p ogabassey-mcp up -d --build --remove-orphans`, and verifies
`http://127.0.0.1:8787/health` before updating the `current` symlink. If the
new container does not become healthy, it attempts to restore the previously
running compose release using the previously running container image instead of
rebuilding during the outage path. Successful deploys prune older release
directories according to `MCP_RELEASE_KEEP_COUNT`.

Example nginx config:
```nginx
server {
    listen 443 ssl http2;
    server_name mcp.ogabassey.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Before deploying with the production Compose default
`MCP_TRUST_PROXY_REAL_IP=true`, verify the active nginx `location` for
`mcp.ogabassey.com` overwrites `X-Real-IP` with `$remote_addr` on every request.
The Compose port is loopback-only. If that proxy contract cannot be verified,
set `MCP_TRUST_PROXY_REAL_IP=false` in the deployment environment until it is.

## Connecting to ChatGPT

1. Go to **ChatGPT Settings → Apps & Connectors → Advanced settings**
2. Enable **Developer mode**
3. Click **Create** under **Connectors**
4. Enter your MCP URL (e.g., `https://mcp.ogabassey.com/mcp` or your ngrok URL)
5. Name: "Ogabassey Store"
6. Description: "Search products, check orders, and get recommendations from Ogabassey"

## Available Tools

| Tool | Description |
|------|-------------|
| `add_to_cart` | Prepare a storefront cart URL without saving a server-side cart |
| `browse_categories` | Browse active store categories |
| `cancel_agentic_checkout_session` | Cancel a mutable signed Baci agentic checkout session |
| `cancel_ucp_cart` | Cancel an active UCP cart |
| `check_order` | Unavailable until customer authorization is implemented |
| `check_payment_status` | Unavailable until customer authorization is implemented |
| `complete_agentic_checkout_session` | Complete a signed Baci agentic checkout session with buyer authorization |
| `convert_ucp_cart_to_checkout` | Create or reuse a checkout session from a UCP cart |
| `create_agentic_checkout_session` | Create a signed Baci agentic checkout session with authoritative totals and fulfillment options |
| `create_ucp_cart` | Create a persistent UCP cart session |
| `generate_payment_account` | Unavailable until customer authorization is implemented |
| `get_agentic_checkout_session` | Read a signed Baci agentic checkout session state |
| `get_brands` | Browse active store brands |
| `get_ucp_cart` | Read a UCP cart session |
| `get_product` | Get detailed product information |
| `get_product_variants` | Get variants, conditions, prices, and availability for a product |
| `get_recommendations` | Heuristic product suggestions by use case and budget |
| `get_shipping_quote` | Explain where to confirm the final delivery fee at checkout |
| `get_store_info` | Shipping, returns, payment info |
| `lookup_ucp_catalog_items` | Fetch exact product IDs through the UCP catalog lookup route |
| `search_ucp_catalog` | Search Ogabassey products using the UCP catalog route |
| `search_products` | Search products by name, price range |
| `update_agentic_checkout_session` | Update items, shipping details, or fulfillment options on a signed Baci agentic checkout session |
| `update_ucp_cart` | Replace UCP cart line items or fulfillment context |

## Example Prompts

Once connected, users can ask:

- "Show me phones under 500,000 naira"
- "What's the iPhone 15 Pro Max price?"
- "Show me the current order tracking page"
- "What's your shipping policy?"
- "I need a laptop for gaming, budget 800k"
- "Create a checkout session for two iPhone 15 Pro Max units"
- "Show me my current checkout session"
- "Update my checkout session to use my Lagos shipping address"
- "Complete my checkout session with my confirmed payment authorization"
- "Cancel my current checkout session"

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public Supabase key used under RLS for shopping tools |
| `MCP_PUBLIC_ORIGIN` | No | Public HTTPS origin for proxied product images (default: `https://mcp.ogabassey.com`; set to the temporary tunnel origin for local ChatGPT QA) |
| `MCP_TRUST_PROXY_REAL_IP` | No | Server default `false`; production Compose default `true` for the loopback nginx proxy. Verify nginx overwrites `X-Real-IP` before deploying, or override to `false`. |
| `MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS` | No | Explicitly forwarded by Compose; defaults to `false`. Set `true` only when checkout credentials and APIs are ready. |
| `BACI_AGENTIC_ACCESS_TOKEN` | Yes for checkout | Baci-owned bearer token for agentic checkout APIs; this is not an OpenAI Platform API key |
| `BACI_AGENTIC_SIGNING_KEY` | Yes for checkout | Baci-owned HMAC signing key for agentic checkout APIs |
| `OPENAI_AGENTIC_API_KEY` | Legacy alias | Backwards-compatible alias for `BACI_AGENTIC_ACCESS_TOKEN` |
| `OPENAI_AGENTIC_SIGNING_KEY` | Legacy alias | Backwards-compatible alias for `BACI_AGENTIC_SIGNING_KEY` |
| `MCP_AGENTIC_CHECKOUT_BASE_URL` | No | Baci storefront/API origin for agentic checkout (default: `https://ogabassey.com`) |
| `MCP_PORT` | No | Server port (default: 8787) |
| `NGROK_AUTHTOKEN` | No | ngrok auth token for dev tunnel |

Signed checkout requests identify this MCP bridge with the `agent-id` value
`openai:baci-mcp`.

## Testing

Test the MCP server with the official inspector:

```bash
npx @modelcontextprotocol/inspector@latest http://localhost:8787/mcp
```

Smoke-test the live MCP deployment:

```bash
curl -fsS https://mcp.ogabassey.com/health
```

Expected healthy response:

```json
{"status":"healthy","database":"connected"}
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│     ChatGPT     │────▶│   MCP Server     │────▶│  Supabase   │
│  (OpenAI App)   │◀────│  (This Server)   │◀────│  Database   │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   Widget UI   │
                        │  (In ChatGPT) │
                        └──────────────┘
```
