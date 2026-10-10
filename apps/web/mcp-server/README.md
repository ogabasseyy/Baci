# Ogabassey ChatGPT MCP Server

This MCP (Model Context Protocol) server enables ChatGPT integration with the Ogabassey store, allowing customers to:

- Search products
- Get product details
- Read public delivery and returns guidance
- Get store information
- Find matching products by category and budget

`search_products` is the single discovery tool. Broad requests such as “for
work” ask for a product type before searching when the intent is ambiguous;
exact names, brands, categories, conditions, and budgets use the ranked catalog
search. The older standalone recommendation tool was removed after it returned
unrelated catalog items for broad use cases. The optional Gemini Embedding 2
fallback is disabled until the index is backfilled and evaluated. It never
overrides merchant, publication, category, condition, option price, or stock
checks.

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

### Public tool output contracts

All ten public tools declare Zod object output schemas: the catalog, store,
and cart-link tools from `../src/schemas/mcp-tool-output.ts`, and the guest
cart tool from `../src/schemas/mcp-guest-cart.ts`. The installed MCP SDK
converts these to JSON Schema in `tools/list` and validates non-error
`structuredContent` before returning a tool result. Keep schemas aligned with
the actual response branches, including empty results, unavailable lookups,
and product-option handoffs.
Never replace an unknown stock value with `true` or invent a delivery quote.

The current SDK requires an object schema at the root, so response fields retain
their existing shape for the widget. Optional fields describe branches where
data is absent; nullable fields describe explicitly unknown catalog facts.
Human-readable `content` and widget metadata remain available alongside the
structured result. For tool execution errors (`isError: true`), SDK 1.29's server
skips output validation. Its client permits absent `structuredContent` on an
error but validates any structured content that is present, including errors.
Ordinary empty/unavailable responses still require a valid structured result.
Empty `get_product` responses include `status` (`invalid_input`, `not_found`, or
`unavailable`) and a safe `message`, alongside the existing `products` array.
The product-detail helper derives its structured result type from this schema.

References: [MCP tool output schemas](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
[OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).
Integration tests use the actual SDK and anonymous catalog fixtures to check
published schemas and successful, empty, missing-product, untracked-stock,
and option-selection results without opening cart links.

### Production deployment

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

Production Compose requires an explicit `MCP_TRUST_PROXY_REAL_IP` value in its
private `.env`. Set it to `true` only after verifying that the active reverse
proxy overwrites `X-Real-IP` with the client IP on **every** request and the
MCP port is inaccessible except through that proxy (the documented Compose
port binding is loopback-only). Set it to `false` for any unverified proxy.
With trust disabled, the server uses the validated socket `remoteAddress`.

## Connecting to ChatGPT

1. Go to **ChatGPT Settings → Apps & Connectors → Advanced settings**
2. Enable **Developer mode**
3. Click **Create** under **Connectors**
4. Enter your MCP URL (e.g., `https://mcp.ogabassey.com/mcp` or your ngrok URL)
5. Name: "Ogabassey Store"
6. Description: "Search Ogabassey products, compare options, and review cart handoffs"

## Available Tools

| Tool | Description |
|------|-------------|
| `update_ogabassey_guest_cart` | Persist a guest cart without login and return a website checkout handoff |
| `prepare_storefront_cart_link` | Prepare a storefront cart URL without saving a server-side cart |
| `add_to_cart` | Deprecated alias of `prepare_storefront_cart_link` for cached tool lists |
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
| `get_delivery_fee_info` | Get live GIG estimates for selected catalog items and destination; ask for missing shipment details |
| `get_store_info` | Shipping, returns, payment info |
| `lookup_ucp_catalog_items` | Fetch exact product IDs through the UCP catalog lookup route |
| `search_ucp_catalog` | Search Ogabassey products using the UCP catalog route |
| `search_products` | Search products by name, price range |
| `update_agentic_checkout_session` | Update items, shipping details, or fulfillment options on a signed Baci agentic checkout session |
| `update_ucp_cart` | Replace UCP cart line items or fulfillment context |

Rollout note: `prepare_storefront_cart_link` was renamed from `add_to_cart`;
the old name stays registered as a deprecated alias on the same handler, so
callers with a cached `tools/list` entry or a hardcoded tool name keep working
while they refresh tool discovery.

## Example Prompts

Once connected, users can ask:

- "Show me phones under 500,000 naira"
- "What's the iPhone 15 Pro Max price?"
- "What's your shipping policy?"
- "I need a laptop for gaming, budget 800k"
- "Add one Apple 20W charger to my cart and let me review it on Ogabassey"

Order lookup, payment-account generation, and signed agentic checkout are
separate, default-off integrations. Do not advertise them in the public app
until customer authorization and production readiness are verified.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public Supabase key used under RLS for shopping tools |
| `MCP_GUEST_CART_WORKER_TOKEN` | Yes | Offline-minted JWT whose role claim is `mcp_guest_cart_worker`, the only role granted on the guest-cart RPCs; the anon key is public and the service key bypasses RLS, so neither may back cart writes |
| `MCP_PUBLIC_ORIGIN` | No | Public HTTPS origin for proxied product images (default: `https://mcp.ogabassey.com`; set to the temporary tunnel origin for local ChatGPT QA) |
| `MCP_TRUST_PROXY_REAL_IP` | Production Compose: yes | The server defaults to `false`. Set `true` only when the reverse proxy overwrites `X-Real-IP` on every request and the MCP port is reachable only through that proxy; otherwise set `false`. When `false` behind a proxy, rate limiting and the guest-cart creation quota key on the proxy socket address, so all callers share one bucket. |
| `MCP_SEMANTIC_SEARCH_ENABLED` | No | Defaults to `false`. Enable only after applying the discovery migration, generating current vectors, and checking search evaluation results. |
| `GEMINI_API_KEY` | For semantic search and catalog backfills | Private Gemini API key for `gemini-embedding-2`; never send it to ChatGPT or a browser. |
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

### Semantic discovery pilot

The append-only `20260928080000_product_discovery_embeddings.sql` migration
creates a separate 768-dimensional Gemini Embedding 2 index. Existing
`products.content_embedding` vectors came from another model and must not be
mixed with Gemini Embedding 2 vectors. The retired `text-embedding-004` product
function is not an indexing source for this pilot. Candidate ranking is exact
after merchant filtering at the current catalog size; an approximate vector
index should be considered only with measured tenant-level recall and latency.

For Ogabassey, a user with product-edit permission can use
`/dashboard/products/discovery` to backfill from their signed-in merchant
session. The dashboard processes five active products per request, skips
unchanged sources, and can be stopped and restarted without handling a JWT.
It uses the server-side Gemini key and keeps semantic search disabled.

For a private operator backfill instead, run
`pnpm --filter @baci/web exec tsx mcp-server/backfill-discovery-embeddings.ts`
with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_ACCESS_TOKEN` (a merchant user's short-lived JWT), `MERCHANT_ID`, and
`GEMINI_API_KEY` supplied privately to the process. Never put them in command
arguments or commit them.
The script uses merchant RLS and processes at most 50 products per invocation
unless `MAX_PRODUCTS` is set. Re-run it after product name, brand, category, or
description changes; the search RPC excludes those stale vectors until refreshed.
Price and stock updates retain the existing vector. Keep the runtime flag disabled if
the initial backfill or recurring refresh cannot be operated. Do not use a
service-role key for the backfill.

Before enabling the flag, compare the app's exact-name, broad-intent,
accessory, price, condition, sold-out, and no-result cases against the lexical
baseline. Record relevant-result rate, false-positive rate, and response time.
The semantic call only runs when lexical discovery returns fewer than the
requested limit and falls back to lexical results on provider failure.

## Catalog colour evidence

The storefront records colours in variant attributes and in explicit product
colour/image mappings (`color_images`). MCP must preserve these catalog labels
so image-backed colour choices remain visible to ChatGPT. A product colour or
colour-image label does not establish stock or a specific colour/storage/price
combination; only an actual variant can establish that combination.

Image pixels, filenames, and description text do not establish a colour choice.
When no explicit catalog colour is returned, report it as unconfirmed.

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

### GIG estimates in ChatGPT

Configure the existing production GIG account using `GIGL_ENABLED=true`, `GIGL_BASE_URL`, `GIGL_EMAIL` and `GIGL_PASSWORD` in the server environment. Keep credentials server-side. The tool uses the anonymous-safe published merchant origin and active catalog items under RLS. It never books shipping or changes carts, orders or payments. City-only requests ask for products and quantities; missing catalog weights require a buyer-confirmed packed weight in kilograms of one unit of each product. GIG multiplies that per-unit weight by quantity: two units at 0.4kg each mean 0.8kg total. If the buyer only knows the combined package weight, ask for the per-unit packed weight or confirm at checkout; do not pass that combined total as a unit weight. Select an exact variant when applicable; condition offers currently require checkout. Quotes include expiry and door/station-pickup type and must be reconfirmed at checkout. The tool does not invent fixed rates or a default weight.

MCP delivery estimates enforce a 100 kg per-unit input bound for both converted catalog weight and buyer-confirmed weight. This is an MCP input limit, not a documented GIG freight limit; larger stored values require a confirmed packed weight within the bound or checkout confirmation. No catalog value is clamped. The existing anonymous public PDP snapshot resolves anchor and variant policies and serialized inventory: strict available-unit counts must cover the aggregate selected quantity, including on untracked parents; serialized-then-unlimited remains purchasable. Other tracked parents, including legacy null stock policies, enforce hydrated catalog stock; only explicitly untracked parents leave legacy variant counts unconfirmed. Snapshot lookup errors, mismatched tenant/product identity, and truncated variant projections fail closed. No direct anonymous variant-table read is used. Sender and receiver station matching both reject contradictory exact city/state pairs without coordinates; exact city matches remain usable when the carrier omits state metadata.

## Guest cart

`update_ogabassey_guest_cart` saves simple products without shopper login. Quantity
is an absolute total (0 removes a line), so retrying with the returned cart token
does not add duplicates. Keep that opaque token with this conversation. It grants
access only to this guest cart; it is not a customer login. Do not put it in logs
or website URLs. Cart rows contain product IDs and quantities, with no buyer details.
Product IDs are UUIDs: `products.id` is a `uuid` column, so the input
schema's `z.string().uuid()` covers the whole catalog and no legacy
non-UUID ID can reach cart storage.

Carts persist in the `mcp_guest_carts` Postgres table, reachable only through
the version-gated `get/upsert/delete_mcp_guest_cart` RPCs; concurrent writers
(including across replicas) serialize through the per-row version gate, so the
server needs no local volume and no replica pin. Expired rows are reclaimed by
the hourly `mcp-guest-cart-cleanup` pg_cron sweep.

### Worker token rotation

The server authenticates to PostgREST with `MCP_GUEST_CART_WORKER_TOKEN`, a
JWT minted offline with the `mcp_guest_cart_worker` role claim; the project
anon key stays in the gateway `apikey` position and the worker JWT travels
in the `Authorization` header. The server validates the token once at
startup — role, expiry, and a minimum 24-hour remaining lifetime — and
then proves it authenticates with one read-only RPC before listening, so
a mis-signed or wrong-project token fails the deploy instead of promoting
a release whose carts are dead. The token is never refreshed at runtime,
so rotation is a deploy operation:

1. Mint a new JWT with the same role claim and a fresh `exp` (ES256, RS256,
   or HS256, signed by the project's JWT keys).
2. Update the secret and redeploy before the old token's `exp`.
3. A token with under 24 hours left refuses to start, so a stale secret
   fails the deploy instead of dying silently mid-run. Rotation is a
   full-availability event: the token is required at startup, so a missing
   or invalid secret stops catalog tools too until it is fixed. Runtime
   storage failures, by contrast, degrade only the cart tool.

If rotation is missed, cart RPCs start failing: the tool logs
`storage_unavailable` with a token-free code and `/health` reports the
degraded store until the secret is rotated and the container restarted.
Guest carts expire seven days after the last update, so active conversations
never expire mid-use; idle carts are reclaimed. Only the changed line is revalidated on
each call, so a stale line never blocks unrelated updates; the website
re-checks stock at transfer. A call with an expired or unknown token returns
`cart_expired: true` instead of a generic failure; the widget retries adds
once without the token and recovers removals locally, so the shopper can keep
shopping without starting over. Removing the last line deletes the cart row
and returns `cart_emptied: true`: the token is retired and must be dropped,
since its next use reports expired.

The website handoff contains only product IDs and quantities. The website reloads
public merchant-scoped products and current availability, preserving existing cart
lines and avoiding duplicate additions when the same snapshot is opened again.
The transfer is additive-only: it raises website lines up to the handoff
quantities but never shrinks or deletes them, so chat-side removals or quantity
decreases do not propagate to an already-transferred website cart.
Products with variants or condition offers continue through explicit website option
selection. Checkout remains on Ogabassey; its existing save-information checkbox
is optional and defaults to off. This feature does not place orders or charge buyers.
