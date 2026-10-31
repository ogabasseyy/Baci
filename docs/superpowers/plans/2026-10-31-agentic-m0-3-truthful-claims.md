# Agentic Milestone 0, plan 3: truthful capability and eligibility claims

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Baci's discovery surfaces advertise only what the code can actually do: every UCP shopping capability declares its schema, cart is declared and served only for merchants enrolled in shared cart, Google Pay is no longer offered to agents, and the OpenAI feed opts no product into native checkout.

**Architecture:** Two small server-side decision modules replace the inline checks in the agent manifest. One decides each payment method's readiness and the other decides cart transfer, and each reports every unmet condition as a reason. The UCP profile reads the manifest it already receives. A shared availability gate makes the cart routes fail closed before they reserve any idempotency key or request ID. Checkout completion, DVA pause and replay behaviour are not touched.

**Tech stack:** Next.js route handlers, TypeScript (strict), Vitest, Biome, pnpm/Turborepo, and the capability-register tooling in `vps-workers/baci-editorial-context`.

**Roadmap:** Task 3 of `docs/superpowers/plans/2026-10-29-agentic-ucp-completion.md` (findings F6, F7, F15, F25 and F34). The tracker is `docs/superpowers/plans/2026-10-30-agentic-ucp-tracker.md`.

---

## Before you start

### Where this plan runs

This is the third Milestone 0 pull request, and they land one at a time. When this plan was written:

- [#3869](https://github.com/ogabasseyy/Baci/pull/3869) (plan 1) was open against `main`.
- [#3873](https://github.com/ogabasseyy/Baci/pull/3873) (plan 2) was open against #3869's branch.

Task 0 picks the base:

- **Case A:** both have merged. Branch from `origin/main`.
- **Case B:** #3873 is still open. Branch from `origin/chore/agentic-baseline-evidence`; the orchestrator opens this pull request against that branch.

### Latest protocol rules (checked 31 October 2026)

| Topic | Rule | Source |
| --- | --- | --- |
| UCP version | `2026-08-25` is released, but Google's implementation guides cover only `2026-04-08`. Stay on `2026-04-08`; the newer version is roadmap Task 17. | [UCP releases](https://github.com/Universal-Commerce-Protocol/ucp/releases), [Google UCP guides](https://developers.google.com/merchant/ucp/implementation/2026-04-08/publish-profile) |
| Capability declaration (F7) | Every capability needs `version`, `spec` and `schema`. Cart: spec `https://ucp.dev/2026-04-08/specification/cart`, schema `https://ucp.dev/2026-04-08/schemas/shopping/cart.json`. Catalog has two capabilities: search (spec `…/specification/catalog/search`, schema `…/schemas/shopping/catalog_search.json`) and lookup (spec `…/specification/catalog/lookup`, schema `…/schemas/shopping/catalog_lookup.json`). | [Overview](https://ucp.dev/2026-04-08/specification/overview/), [cart REST](https://ucp.dev/2026-04-08/specification/cart-rest/), [catalog REST](https://ucp.dev/2026-04-08/specification/catalog/rest/) |
| Payment handlers (F6) | `ucp.payment_handlers` must be present, and may be empty. Google's current `com.google.pay` handler is versioned `2026-01-23` and has a different config (`merchant_info`, `allowed_payment_methods`). Google says the PSP must be able to process its tokens. | [Google Pay UCP config](https://developers.google.com/pay/api/universal-commerce-protocol/reference/config), [UCP FAQ](https://developers.google.com/merchant/ucp/faq) |
| Cart operations (F15) | Create `POST /carts`, get `GET /carts/{id}`, update `PUT /carts/{id}`, cancel `POST /carts/{id}/cancel`. The spec does not say which operations are mandatory. Google's cart transfer uses `CreateCart` only, and its Merchant Center test tool marks get, update and cancel as optional. | [Cart REST](https://ucp.dev/2026-04-08/specification/cart-rest/), [Google cart overview](https://developers.google.com/merchant/ucp/guides/overview/cart-overview), [integration tool](https://developers.google.com/merchant/ucp/guides/merchant-center/integration) |
| Cart eligibility (F25) | Cart transfer is opt-out: once `dev.ucp.shopping.cart` is declared, every product approved for free listings is eligible unless the feed sends `native_commerce(cart_eligibility)=FALSE`. The whole group is overwritten on each upload. The hub is rolling out in the US only. | [Merchant Center guidance](https://developers.google.com/merchant/ucp/guides/overview/merchant-center) |
| OpenAI feed (F6) | `is_eligible_search` and `is_eligible_checkout` are the current names. `enable_search` and `enable_checkout` are accepted aliases, and they win when both are sent. Checkout needs a separately enabled OpenAI integration, and setting the flag does not complete onboarding. | [Product feed spec](https://developers.openai.com/commerce/specs/file-upload/products) |
| ACP version | The latest released version is `2026-04-17`; `2026-04-30` does not exist (F41, roadmap Task 5, not this plan). | [ACP repository](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) |

### Production baseline (plan 2, 31 October 2026)

Ogabassey is the only agentic merchant. Its state:

- Shared cart enrolled, and `/.well-known/ucp` declares cart.
- Checkout is not declared, there are no payment handlers, and Google Pay is not declared.
- Pay on delivery is off.

### What changes live when this plan merges

A merge to `main` deploys, so the owner decides when.

- **Ogabassey `/.well-known/ucp`:** the cart, catalog search and catalog lookup declarations gain `schema`, and the catalog `spec` URLs move to the search and lookup pages. Cart stays, because Ogabassey is enrolled in shared cart. Checkout and payment output do not change.
- **Ogabassey agent manifest (`/.well-known/agent-commerce.json`):** `capabilities` gains `cart.transfer`. `payment_handler_configs` is removed; it was empty for Ogabassey.
- **OpenAI legacy feed (`/api/feed/openai`, `/feeds/openai.jsonl`):** every row says `enable_checkout: false`, where it used to say `true`. Search stays `true`.
- **Merchant not enrolled in shared cart:** no cart declaration, and the cart routes answer `404 cart_unavailable`. Today no such merchant has agent access, because agentic access is single-tenant.

### Owner decisions

Proceed with the default unless the owner says otherwise. Record each answer in the tracker.

1. **Feed checkout flag.** Default: `enable_checkout: false` on every row, until an OpenAI checkout integration is approved and recorded (roadmap Tasks 8 and 13).
2. **Cart eligibility policy (F25).** Default: keep cart declared for shared-cart merchants. Google treats every free-listing product as cart-eligible; per-product `cart_eligibility` flags arrive with Task 8, and Google's hub is US-only today. The limitation is recorded in the register.
3. **Create-only cart (F15).** Default: keep the cart declaration, record "update via `PUT` is not supported", and confirm with Google in Task 9. Do not add an unversioned full-replacement `PUT`.
4. **Gated cart responses.** Default:
   - `404 { error: 'Cart transfer is not available for this store', code: 'cart_unavailable' }` when the merchant is not enrolled.
   - `503 { error: 'Cart availability could not be checked', code: 'cart_availability_unknown' }` when the enrollment read fails.

### Out of scope

The roadmap assigns these to other tasks, so do not change them here:

- **Checkout completion:** a direct UCP completion that names `google_pay` is still normalized to Paystack and creates a DVA (Task 13; recorded as a limitation).
- **Legacy cart fallback:** the `?agentic_cart_id=` responses become unreachable once the gate lands; Task 4 proves that and removes them.
- **Prices and units:** Task 4.
- **ACP and MCP versions:** Task 5.

### Repository rules for every task

- **One primary export per file, files ≤300 lines, colocated `*.test.ts`.** Check with `bash ci_scripts/quality-gate-missing-tests.sh`.
- **Never `select('*')`, never a service-role client, never edit `apps/web/src/proxy.ts`, `apps/web/src/config/business-types.ts` or `.env*`.**
- **Prefix pnpm with `npm_config_verify_deps_before_run=false`.** Without it pnpm runs a full install.
- **Format with the repository's Biome.** From the worktree root: `./node_modules/.bin/biome check --write <files>`. Never use `npx`.
- **Commit with `LEFTHOOK_EXCLUDE=knip git commit -F <message file>`.** Never use `--no-verify`. End each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (or the model you are). Keep the word "main" out of commit messages.
- **Do not push.** The orchestrator pushes, keeping commit IDs identical.
- **CodeRabbit is optional.** Run `coderabbit review --agent -t uncommitted` before each commit if it is available. If it is rate-limited or errors, skip it and say so in your report.

---

## File map

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `apps/web/src/lib/agentic/ucp-shopping-capability-urls.ts` (+ test) | Spec and schema URLs for every `2026-04-08` shopping declaration |
| Modify | `apps/web/src/lib/agentic/ucp-shopping-profile.ts` (+ test) | Every declaration carries `schema`; cart follows `cart.transfer` |
| Modify | `apps/web/src/lib/agentic/ucp-profile-constants.ts` | Add `CART_TRANSFER_CAPABILITY` |
| Create | `apps/web/src/lib/agentic/decide-agentic-payment-methods.ts` (+ test) | Per-method payment readiness with reasons; Google Pay never ready |
| Create | `apps/web/src/lib/agentic/decide-ucp-cart-transfer.ts` (+ test) | Cart transfer readiness: signed agent access and shared-cart enrollment |
| Modify | `apps/web/src/lib/agentic/agent-commerce-manifest.ts` (+ test) | Use both decisions; drop `payment_handler_configs` |
| Modify | `apps/web/src/lib/agentic/ucp-discovery-profile.ts` (+ payment test) | Drop the `com.google.pay` handler branch |
| Create | `apps/web/src/lib/agentic/is-ucp-shared-cart-enabled.ts` (+ test) | One live reader of shared-cart enrollment |
| Create | `apps/web/src/lib/agentic/ucp-cart-availability.ts` (+ test) | Fail-closed cart route gate (404 / 503) |
| Modify | `apps/web/src/lib/agentic/ucp-canonical-cart.ts` | Use the shared reader |
| Modify | `apps/web/src/lib/agentic/ucp-cart-route-support.ts` (+ new test) | Gate inside `resolveUcpCartContext` |
| Modify | `apps/web/src/app/api/agentic/carts/route.ts` | Gate before idempotency reservation |
| Create | `apps/web/src/app/api/agentic/carts/route-shared-cart-gate.test.ts` | Create route fails closed before reservations |
| Create | `apps/web/src/app/api/agentic/carts/[id]/shared-cart-gate.test.ts` | Read, update, cancel and checkout fail closed before reservations |
| Modify | five existing cart route tests | Mock the reader as enrolled |
| Create | `apps/web/src/config/openai-legacy-feed-eligibility.ts` | Search on, checkout off |
| Modify | `apps/web/src/app/api/feed/openai/legacy-feed-generator.ts` (+ test) | Use the eligibility constant |
| Modify | `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`, `ucp-conformance-data.ts` | F7 and F34 are no longer known gaps |
| Modify | `docs/product/baci-capabilities.json`, `docs/product/agent-access-map.md` | Limitations, evidence cells, re-review (last) |

---

### Task 0: Worktree

**Files:** none.

- [ ] **Step 1: Pick the base and create the worktree**

```bash
cd /Users/mac/Baci-app
git fetch origin
gh pr view 3869 --json state --jq .state
gh pr view 3873 --json state --jq .state
```

If both print `MERGED` (case A):

```bash
git worktree add -b fix/agentic-truthful-capability-claims .worktrees/agentic-m0-3-truthful-claims origin/main
```

Otherwise (case B):

```bash
git worktree add -b fix/agentic-truthful-capability-claims .worktrees/agentic-m0-3-truthful-claims origin/chore/agentic-baseline-evidence
git -C .worktrees/agentic-m0-3-truthful-claims config branch.fix/agentic-truthful-capability-claims.base origin/chore/agentic-baseline-evidence
```

- [ ] **Step 2: Install and record the baseline**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
pnpm install --frozen-lockfile --prefer-offline
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/api/agentic/carts src/app/.well-known/ucp src/app/api/feed/openai src/app/feeds
```

Expected: everything passes, apart from the `.fails` known-gap tests, which Vitest counts as expected failures. Write the totals down; Task 7 compares against them.

---

### Task 1: Every UCP shopping capability declares its schema (F7)

**Files:**
- Create: `apps/web/src/lib/agentic/ucp-shopping-capability-urls.ts`, `apps/web/src/lib/agentic/ucp-shopping-capability-urls.test.ts`
- Modify: `apps/web/src/lib/agentic/ucp-shopping-profile.ts`, `apps/web/src/lib/agentic/ucp-shopping-profile.test.ts`, `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`

- [ ] **Step 1: Turn the F7 known gap into a real test**

In `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`, delete the two comment lines above the F7 test (`// Roadmap Task 3 (plan 3) adds the schema URL…`) and change

```ts
    it.fails('F7: every dev.ucp.shopping capability declares schema', async () => {
```

to

```ts
    it('F7: every dev.ucp.shopping capability declares schema', async () => {
```

- [ ] **Step 2: Add the URL module test**

Create `apps/web/src/lib/agentic/ucp-shopping-capability-urls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { UCP_SHOPPING_URLS } from './ucp-shopping-capability-urls';

describe('UCP_SHOPPING_URLS', () => {
  it('uses the 2026-04-08 cart and catalog spec and schema URLs', () => {
    expect(UCP_SHOPPING_URLS.cart).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
      spec: 'https://ucp.dev/2026-04-08/specification/cart',
    });
    expect(UCP_SHOPPING_URLS.catalogSearch).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_search.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/search',
    });
    expect(UCP_SHOPPING_URLS.catalogLookup).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_lookup.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/lookup',
    });
  });

  it('keeps the checkout, order and service URLs the profile already used', () => {
    expect(UCP_SHOPPING_URLS.checkout).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/checkout.json',
      spec: 'https://ucp.dev/2026-04-08/specification/checkout',
    });
    expect(UCP_SHOPPING_URLS.order).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/order.json',
      spec: 'https://ucp.dev/2026-04-08/specification/order',
    });
    expect(UCP_SHOPPING_URLS.service).toEqual({
      schema: 'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
      spec: 'https://ucp.dev/2026-04-08/specification/overview',
    });
  });
});
```

Then, at the end of the `describe` in `apps/web/src/lib/agentic/ucp-shopping-profile.test.ts`, after the `builds cart and catalog operations without slash drift` test, add:

```ts
  it('declares spec and schema on the cart and both catalog capabilities', () => {
    const capabilities = buildUcpCapabilities({
      agentCommerceManifestUrl: 'https://ogabassey.com/agent-commerce.json',
      agenticApiBaseUrl: 'https://ogabassey.com/api/agentic',
      manifest: signedManifest(),
    });
    const pick = (name: string) => {
      const [declaration] = capabilities[name] as Array<{
        schema?: string;
        spec?: string;
      }>;
      return { schema: declaration.schema, spec: declaration.spec };
    };

    expect(pick('dev.ucp.shopping.cart')).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
      spec: 'https://ucp.dev/2026-04-08/specification/cart',
    });
    expect(pick('dev.ucp.shopping.catalog.search')).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_search.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/search',
    });
    expect(pick('dev.ucp.shopping.catalog.lookup')).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_lookup.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/lookup',
    });
  });
```

`signedManifest()` is the existing helper in that file. If its manifest has no cart, because Task 3 has not run yet, the test still fails here for the right reason.

- [ ] **Step 3: Run the tests and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/ucp-shopping-capability-urls.test.ts src/lib/agentic/ucp-shopping-profile.test.ts src/lib/agentic/fixtures/ucp-conformance.test.ts
```

Expected:
- the URL test fails because the module does not exist;
- the new profile test fails because cart and catalog have no `schema` and the catalog spec is `…/specification/catalog`;
- the F7 conformance test fails because `withoutSchema` lists cart and both catalog capabilities.

- [ ] **Step 4: Create the URL module**

Create `apps/web/src/lib/agentic/ucp-shopping-capability-urls.ts`:

```ts
import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-profile-constants';

const PROFILE_BASE = `https://ucp.dev/${UCP_PROFILE_VERSION}`;
const SPEC_BASE = `${PROFILE_BASE}/specification`;
const SCHEMA_BASE = `${PROFILE_BASE}/schemas/shopping`;

/**
 * Spec and schema URLs for the UCP shopping declarations. Every capability
 * declaration needs `version`, `spec` and `schema`
 * (https://ucp.dev/2026-04-08/specification/overview/). The cart and catalog
 * values match the cart and catalog REST bindings and Google's published
 * profile example; catalog is two capabilities, search and lookup.
 */
export const UCP_SHOPPING_URLS = {
  cart: { schema: `${SCHEMA_BASE}/cart.json`, spec: `${SPEC_BASE}/cart` },
  catalogLookup: {
    schema: `${SCHEMA_BASE}/catalog_lookup.json`,
    spec: `${SPEC_BASE}/catalog/lookup`,
  },
  catalogSearch: {
    schema: `${SCHEMA_BASE}/catalog_search.json`,
    spec: `${SPEC_BASE}/catalog/search`,
  },
  checkout: {
    schema: `${SCHEMA_BASE}/checkout.json`,
    spec: `${SPEC_BASE}/checkout`,
  },
  order: { schema: `${SCHEMA_BASE}/order.json`, spec: `${SPEC_BASE}/order` },
  service: {
    schema: `${PROFILE_BASE}/services/shopping/rest.openapi.json`,
    spec: `${SPEC_BASE}/overview`,
  },
} as const;
```

- [ ] **Step 5: Use it in the profile and make `schema` required**

In `apps/web/src/lib/agentic/ucp-shopping-profile.ts`:

1. Replace everything from the first line down to and including `type OperationMap = Record<string, string>;` with:

```ts
import type { AgentCommerceManifest } from '@/lib/agentic/agent-commerce-manifest';
import {
  CHECKOUT_SESSION_CAPABILITIES,
  UCP_PROFILE_VERSION,
} from '@/lib/agentic/ucp-profile-constants';
import { UCP_SHOPPING_URLS } from '@/lib/agentic/ucp-shopping-capability-urls';

const UCP_CHECKOUT_CAPABILITY = 'dev.ucp.shopping.checkout';
const UCP_CART_CAPABILITY = 'dev.ucp.shopping.cart';
const UCP_CATALOG_SEARCH_CAPABILITY = 'dev.ucp.shopping.catalog.search';
const UCP_CATALOG_LOOKUP_CAPABILITY = 'dev.ucp.shopping.catalog.lookup';
const UCP_ORDER_CAPABILITY = 'dev.ucp.shopping.order';
const UCP_SHOPPING_SERVICE = 'dev.ucp.shopping';
type OperationMap = Record<string, string>;
```

2. In the catalog search `buildRestCapability({...})` call, replace `spec: UCP_CATALOG_SPEC_URL,` with `...UCP_SHOPPING_URLS.catalogSearch,`.
3. In the catalog lookup call, replace `spec: UCP_CATALOG_SPEC_URL,` with `...UCP_SHOPPING_URLS.catalogLookup,`.
4. In the cart call, replace `spec: UCP_CART_SPEC_URL,` with `...UCP_SHOPPING_URLS.cart,`.
5. In `buildUcpCheckoutCapability`, replace

```ts
    schema: UCP_CHECKOUT_SCHEMA_URL,
    spec: UCP_CHECKOUT_SPEC_URL,
```

with `...UCP_SHOPPING_URLS.checkout,`.

6. In `buildUcpOrderCapability`, replace

```ts
    schema: UCP_ORDER_SCHEMA_URL,
    spec: UCP_ORDER_SPEC_URL,
```

with `...UCP_SHOPPING_URLS.order,`.

7. In `buildUcpServices`, replace

```ts
        schema: UCP_SHOPPING_REST_SCHEMA_URL,
        spec: UCP_SHOPPING_SPEC_URL,
```

with `...UCP_SHOPPING_URLS.service,`.

8. In `buildRestCapability`, change the parameter type `schema?: string;` to `schema: string;` and the returned object from

```ts
  return {
    version: UCP_PROFILE_VERSION,
    spec,
    ...(schema ? { schema } : {}),
```

to

```ts
  return {
    version: UCP_PROFILE_VERSION,
    spec,
    schema,
```

Making `schema` required means TypeScript rejects any future declaration that omits it.

- [ ] **Step 6: Run the tests again**

Same command as Step 3. Expected:
- the URL test passes;
- the conformance F7 test passes;
- the new profile test passes once `signedManifest()` yields a cart. If it still fails only because cart is absent, leave it red and continue: Task 3 makes cart follow `cart.transfer`, and Task 3 Step 7 reruns it.

Then fix every other test that pinned the old catalog spec URL:

```bash
grep -rn "specification/catalog'" src mcp-server --include="*.test.ts"
grep -rn 'specification/catalog"' src mcp-server --include="*.test.ts"
```

Change each to the search or lookup URL that matches the capability under test. Run:

```bash
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/.well-known/ucp
```

Expected: no new failures apart from the cart-presence test noted above.

- [ ] **Step 7: Format, check and commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
./node_modules/.bin/biome check --write apps/web/src/lib/agentic/ucp-shopping-capability-urls.ts apps/web/src/lib/agentic/ucp-shopping-capability-urls.test.ts apps/web/src/lib/agentic/ucp-shopping-profile.ts apps/web/src/lib/agentic/ucp-shopping-profile.test.ts apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts
wc -l apps/web/src/lib/agentic/ucp-shopping-profile.ts
git add apps/web/src/lib/agentic/ucp-shopping-capability-urls.ts apps/web/src/lib/agentic/ucp-shopping-capability-urls.test.ts apps/web/src/lib/agentic/ucp-shopping-profile.ts apps/web/src/lib/agentic/ucp-shopping-profile.test.ts apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts
```

Also `git add` any test file you changed in Step 6. `wc -l` must print at most 300. Commit with the message:

```
fix(agentic): declare the schema on every UCP shopping capability

Cart and catalog declarations now carry the 2026-04-08 schema URL, and the
catalog specs point at the search and lookup pages. buildRestCapability
requires a schema, so a declaration can no longer omit it (F7).
```

---

### Task 2: Google Pay is never advertised to agents (F6)

**Files:**
- Create: `apps/web/src/lib/agentic/decide-agentic-payment-methods.ts`, `apps/web/src/lib/agentic/decide-agentic-payment-methods.test.ts`
- Modify: `apps/web/src/lib/agentic/agent-commerce-manifest.ts`, `apps/web/src/lib/agentic/agent-commerce-manifest.test.ts`, `apps/web/src/lib/agentic/ucp-discovery-profile.ts`, `apps/web/src/lib/agentic/ucp-discovery-profile-payment.test.ts`

- [ ] **Step 1: Write the decision test**

Create `apps/web/src/lib/agentic/decide-agentic-payment-methods.test.ts`:

```ts
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { decideAgenticPaymentMethods } from '@/lib/agentic/decide-agentic-payment-methods';

vi.mock('server-only', () => ({}));

type PaymentMerchant = Parameters<typeof decideAgenticPaymentMethods>[0];

const CONFIGURED: PaymentMerchant = {
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
};

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
}

function stubPaystackGooglePay() {
  vi.stubEnv('BACI_GOOGLE_PAY_ENABLED', 'true');
  vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY', 'paystack');
  vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID', 'paystack-merchant-id');
  vi.stubEnv('BACI_GOOGLE_PAY_MERCHANT_ID', 'google-merchant-id');
}

async function decide(merchant: PaymentMerchant = CONFIGURED) {
  const { decideAgenticPaymentMethods } = await import(
    '@/lib/agentic/decide-agentic-payment-methods'
  );
  return decideAgenticPaymentMethods(merchant);
}

describe('decideAgenticPaymentMethods', () => {
  beforeEach(() => {
    vi.resetModules();
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('readies Paystack bank transfer and pay on delivery when both are configured', async () => {
    expect(await decide()).toEqual([
      { method: 'paystack_bank_transfer', ready: true, reasons: [] },
      {
        method: 'google_pay',
        ready: false,
        reasons: [
          'google_pay_token_charging_unsupported',
          'google_pay_not_configured',
        ],
      },
      { method: 'pay_on_delivery', ready: true, reasons: [] },
    ]);
  });

  it('never readies Google Pay, even with explicit Paystack gateway config, because completion would create a DVA', async () => {
    stubPaystackGooglePay();

    const googlePay = (await decide()).find(
      (decision) => decision.method === 'google_pay'
    );

    expect(googlePay).toEqual({
      method: 'google_pay',
      ready: false,
      reasons: ['google_pay_token_charging_unsupported'],
    });
  });

  it('lists every unmet Google Pay condition independently', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const googlePay = (await decide()).find(
      (decision) => decision.method === 'google_pay'
    );

    expect(googlePay?.reasons).toEqual([
      'google_pay_token_charging_unsupported',
      'paystack_dva_paused',
      'google_pay_not_configured',
    ]);
  });

  it('withholds only Paystack bank transfer while DVA is paused', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const decisions = await decide();

    expect(decisions[0]).toEqual({
      method: 'paystack_bank_transfer',
      ready: false,
      reasons: ['paystack_dva_paused'],
    });
    expect(
      decisions.filter((decision) => decision.ready).map((d) => d.method)
    ).toEqual(['pay_on_delivery']);
  });

  it('reports a missing Paystack secret, subaccount and pay on delivery separately', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', '');

    const decisions = await decide({
      feature_settings: { pay_on_delivery_enabled: false },
      paystack_subaccount_code: null,
    });

    expect(decisions[0].reasons).toEqual([
      'paystack_secret_missing',
      'paystack_subaccount_missing',
    ]);
    expect(decisions[2]).toEqual({
      method: 'pay_on_delivery',
      ready: false,
      reasons: ['pay_on_delivery_disabled'],
    });
  });

  it('accepts the storefront snapshot subaccount hint when the raw code is omitted', async () => {
    const decisions = await decide({
      feature_settings: { pay_on_delivery_enabled: false },
      paystack_subaccount_code: null,
      paystack_subaccount_configured: true,
    });

    expect(decisions[0]).toEqual({
      method: 'paystack_bank_transfer',
      ready: true,
      reasons: [],
    });
  });
});
```

- [ ] **Step 2: Rewrite the manifest's Google Pay tests to expect no Google Pay**

In `apps/web/src/lib/agentic/agent-commerce-manifest.test.ts` (362 lines; this step shrinks it):

1. Delete the test `does not include Google Pay when processor config is absent`. The decision test now covers it.
2. Replace the whole test `includes Google Pay only when Paystack gateway config is explicit` with:

```ts
  it('never advertises Google Pay, even with explicit Paystack gateway config', async () => {
    vi.stubEnv('BACI_GOOGLE_PAY_ENABLED', 'true');
    vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY', 'paystack');
    vi.stubEnv('BACI_GOOGLE_PAY_GATEWAY_MERCHANT_ID', 'paystack-merchant-id');
    vi.stubEnv('BACI_GOOGLE_PAY_MERCHANT_ID', 'google-merchant-id');

    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const manifest = buildAgentCommerceManifest(
      {
        business_name: 'Ogabassey',
        feature_settings: { pay_on_delivery_enabled: false },
        paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
        slug: 'ogabassey',
      },
      'https://ogabassey.com'
    );

    expect(manifest.payment_methods).toEqual(['paystack_bank_transfer']);
    expect(manifest).not.toHaveProperty('payment_handler_configs');
  });
```

3. In the test `suppresses Paystack-backed Google Pay while DVA is paused`, delete the line `expect(manifest.payment_handler_configs).toBeUndefined();`. The test still pins that a paused DVA with no other method removes checkout.

Run `wc -l apps/web/src/lib/agentic/agent-commerce-manifest.test.ts`. If it is still above 300, move the two `*DVA*` tests (`removes only Paystack bank transfer while the DVA mode is paused` and `removes checkout mutations when paused DVA is the only payment method`) unchanged into a new `apps/web/src/lib/agentic/agent-commerce-manifest-dva-pause.test.ts`. Copy the file's `vi.mock('server-only'…)`, `stubBaseEnv`, `beforeEach` and `afterEach` with them.

- [ ] **Step 3: Rewrite the UCP payment-handler test**

In `apps/web/src/lib/agentic/ucp-discovery-profile-payment.test.ts`, replace the whole test `advertises Google Pay only when explicitly configured` with:

```ts
  it('never emits a com.google.pay handler, even if a manifest lists google_pay', () => {
    const profile = buildUcpDiscoveryProfile(
      buildManifest({
        payment_methods: ['paystack_bank_transfer', 'google_pay'],
      })
    );

    expect(profile.ucp.payment_handlers).not.toHaveProperty('com.google.pay');
    expect(profile.ucp.payment_handlers).toHaveProperty(
      'com.paystack.bank_transfer'
    );
  });
```

If `buildManifest`'s defaults set `payment_handler_configs`, delete that property from them.

- [ ] **Step 4: Run the tests and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/decide-agentic-payment-methods.test.ts src/lib/agentic/agent-commerce-manifest src/lib/agentic/ucp-discovery-profile-payment.test.ts
```

Expected:
- the decision test fails because the module does not exist;
- the manifest test fails because `payment_methods` includes `google_pay` and `payment_handler_configs` is present;
- the payment-handler test fails because `com.google.pay` is emitted.

- [ ] **Step 5: Create the decision module**

Create `apps/web/src/lib/agentic/decide-agentic-payment-methods.ts`:

```ts
import {
  AGENTIC_PAYMENT_METHOD_GOOGLE_PAY,
  AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY,
  AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER,
  type AgenticPaymentMethod,
} from '@/config/agentic-payment-methods';
import { getGooglePayAgenticConfig, getPaystackSecretKey } from '@/env';
import { isAgenticPaystackDvaPaused } from '@/lib/agentic/agentic-paystack-dva-paused';
import { isValidPaystackSubaccountCode } from '@/lib/agentic/paystack';
import type { CachedMerchant } from '@/lib/cached-data';

export type AgenticPaymentReadinessReason =
  | 'google_pay_not_configured'
  | 'google_pay_token_charging_unsupported'
  | 'pay_on_delivery_disabled'
  | 'paystack_dva_paused'
  | 'paystack_secret_missing'
  | 'paystack_subaccount_missing';

export type AgenticPaymentMethodDecision = {
  method: AgenticPaymentMethod;
  ready: boolean;
  reasons: AgenticPaymentReadinessReason[];
};

type PaymentMerchant = Pick<
  CachedMerchant,
  | 'feature_settings'
  | 'paystack_subaccount_code'
  | 'paystack_subaccount_configured'
>;

function decision(
  method: AgenticPaymentMethod,
  reasons: AgenticPaymentReadinessReason[]
): AgenticPaymentMethodDecision {
  return { method, ready: reasons.length === 0, reasons };
}

/**
 * Decides, per payment method, whether an agent may be told it can pay that
 * way, listing every unmet condition independently. The order is the order
 * the manifest advertises them in.
 *
 * Google Pay is never ready: UCP completion normalizes a Google Pay
 * instrument to Paystack and creates a dedicated virtual account instead of
 * charging the token (roadmap Task 13). A hosted-website Google Pay setting
 * is not the ability to charge a UCP token.
 */
export function decideAgenticPaymentMethods(
  merchant: PaymentMerchant
): AgenticPaymentMethodDecision[] {
  const paystackReasons: AgenticPaymentReadinessReason[] = [];
  if (!getPaystackSecretKey()) paystackReasons.push('paystack_secret_missing');
  // The public storefront snapshot omits the raw paystack_subaccount_code and
  // exposes the derived paystack_subaccount_configured hint instead, so the
  // public capability check accepts either signal (mirroring
  // isPaystackCheckoutAvailable). Private payment paths stay authoritative
  // over the raw code when a session is actually charged.
  if (
    !isValidPaystackSubaccountCode(merchant.paystack_subaccount_code) &&
    merchant.paystack_subaccount_configured !== true
  ) {
    paystackReasons.push('paystack_subaccount_missing');
  }
  if (isAgenticPaystackDvaPaused()) paystackReasons.push('paystack_dva_paused');

  const googlePayReasons: AgenticPaymentReadinessReason[] = [
    'google_pay_token_charging_unsupported',
    ...paystackReasons,
  ];
  if (getGooglePayAgenticConfig()?.gateway !== 'paystack') {
    googlePayReasons.push('google_pay_not_configured');
  }

  return [
    decision(AGENTIC_PAYMENT_METHOD_PAYSTACK_BANK_TRANSFER, paystackReasons),
    decision(AGENTIC_PAYMENT_METHOD_GOOGLE_PAY, googlePayReasons),
    decision(
      AGENTIC_PAYMENT_METHOD_PAY_ON_DELIVERY,
      merchant.feature_settings?.pay_on_delivery_enabled === true
        ? []
        : ['pay_on_delivery_disabled']
    ),
  ];
}
```

- [ ] **Step 6: Make the manifest use the decision**

In `apps/web/src/lib/agentic/agent-commerce-manifest.ts`:

1. Replace the import block from the first line down to and including the `@/lib/storefront-agent-urls` import with:

```ts
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';
import type { AgenticPaymentMethod } from '@/config/agentic-payment-methods';
import { decideAgenticPaymentMethods } from '@/lib/agentic/decide-agentic-payment-methods';
import {
  getConfiguredAgenticMerchantSlug,
  isAgenticCheckoutRuntimeConfigured,
} from '@/lib/agentic/merchant-context';
import { SUPPORTED_AGENTIC_API_VERSIONS } from '@/lib/agentic/request-integrity';
import type { CachedMerchant } from '@/lib/cached-data';
import {
  type AgentPolicyUrls,
  buildAgentPolicyUrls,
} from '@/lib/storefront-agent-urls';
```

Biome sorts imports on `check --write`; accept its order.

2. In `export type AgentCommerceManifest`, delete:

```ts
  payment_handler_configs?: {
    google_pay?: GooglePayAgenticConfig;
  };
```

3. In `buildAgentCommerceManifest`, replace

```ts
  const googlePayConfig = getGooglePayAgenticConfig();
  const paymentMethods = buildAgenticPaymentMethods(merchant, googlePayConfig);
  const enabledGooglePayConfig = paymentMethods.includes(
    AGENTIC_PAYMENT_METHOD_GOOGLE_PAY
  )
    ? googlePayConfig
    : null;
```

with

```ts
  const paymentMethods = decideAgenticPaymentMethods(merchant)
    .filter((decision) => decision.ready)
    .map((decision) => decision.method);
```

4. Delete

```ts
    ...(checkoutEnabled && enabledGooglePayConfig
      ? { payment_handler_configs: { google_pay: enabledGooglePayConfig } }
      : {}),
```

5. Delete the whole `function buildAgenticPaymentMethods(…) { … }`.

- [ ] **Step 7: Drop the Google Pay handler branch from the UCP profile**

In `apps/web/src/lib/agentic/ucp-discovery-profile.ts`:

1. Remove `AGENTIC_PAYMENT_METHOD_GOOGLE_PAY,` from the `@/config/agentic-payment-methods` import.
2. In `buildUcpPaymentHandlers`, change the manifest `Pick<…>` from `'payment_handler_configs' | 'payment_methods' | 'schema_version'` to `'payment_methods' | 'schema_version'`.
3. Delete the whole `if (paymentMethods.includes(AGENTIC_PAYMENT_METHOD_GOOGLE_PAY)) { … }` block.

Leave `AGENTIC_PAYMENT_METHOD_GOOGLE_PAY` itself and `ucp-request-adapters.ts` alone. Direct completions are roadmap Task 13.

- [ ] **Step 8: Run the tests, then the whole agentic folder**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/decide-agentic-payment-methods.test.ts src/lib/agentic/agent-commerce-manifest src/lib/agentic/ucp-discovery-profile-payment.test.ts
grep -rn "payment_handler_configs\|buildAgenticPaymentMethods" src mcp-server
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/.well-known src/app/api/agentic
```

Expected:
- the first run passes;
- `grep` prints nothing;
- the folder run shows no failures beyond Task 1's cart-presence test.

Some other test may still expect `google_pay` in a manifest built from env, or a `com.google.pay` handler. Change it to expect no Google Pay, and say which test in your report.

- [ ] **Step 9: Format, check and commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
./node_modules/.bin/biome check --write apps/web/src/lib/agentic/decide-agentic-payment-methods.ts apps/web/src/lib/agentic/decide-agentic-payment-methods.test.ts apps/web/src/lib/agentic/agent-commerce-manifest.ts apps/web/src/lib/agentic/agent-commerce-manifest.test.ts apps/web/src/lib/agentic/ucp-discovery-profile.ts apps/web/src/lib/agentic/ucp-discovery-profile-payment.test.ts
bash ci_scripts/quality-gate-missing-tests.sh
```

Also format `agent-commerce-manifest-dva-pause.test.ts` and any test you changed in Step 8, if they exist. Stage exactly those files and commit:

```
fix(agentic): stop advertising Google Pay to agents

UCP completion turns a Google Pay instrument into a Paystack dedicated
virtual account instead of charging the token, so Google Pay is never ready.
A new decision module reports each payment method's unmet conditions; the
manifest advertises only ready methods and no longer carries
payment_handler_configs (F6).
```

---

### Task 3: Cart is declared only for shared-cart merchants (F34, profile)

**Files:**
- Create: `apps/web/src/lib/agentic/decide-ucp-cart-transfer.ts`, `apps/web/src/lib/agentic/decide-ucp-cart-transfer.test.ts`
- Modify: `apps/web/src/lib/agentic/ucp-profile-constants.ts`, `apps/web/src/lib/agentic/agent-commerce-manifest.ts`, `apps/web/src/lib/agentic/ucp-shopping-profile.ts`, `apps/web/src/lib/agentic/fixtures/ucp-conformance-data.ts`, `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`, and the tests listed in Step 7

- [ ] **Step 1: Write the decision test**

Create `apps/web/src/lib/agentic/decide-ucp-cart-transfer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideUcpCartTransfer } from './decide-ucp-cart-transfer';

describe('decideUcpCartTransfer', () => {
  it('is ready for a shared-cart merchant with signed agent access', () => {
    expect(
      decideUcpCartTransfer({
        merchant: { shared_cart_enabled: true },
        signedAgentReadsEnabled: true,
      })
    ).toEqual({ ready: true, reasons: [] });
  });

  it('withholds cart from a merchant not enrolled in shared cart', () => {
    expect(
      decideUcpCartTransfer({
        merchant: { shared_cart_enabled: false },
        signedAgentReadsEnabled: true,
      })
    ).toEqual({ ready: false, reasons: ['shared_cart_not_enrolled'] });
  });

  it('treats a missing enrollment signal as not enrolled', () => {
    expect(
      decideUcpCartTransfer({ merchant: {}, signedAgentReadsEnabled: true })
    ).toEqual({ ready: false, reasons: ['shared_cart_not_enrolled'] });
  });

  it('lists missing agent access and enrollment independently', () => {
    expect(
      decideUcpCartTransfer({ merchant: {}, signedAgentReadsEnabled: false })
    ).toEqual({
      ready: false,
      reasons: ['signed_agent_access_unavailable', 'shared_cart_not_enrolled'],
    });
  });

  it('reads the snapshot hint and the raw premium_features grant the same way', () => {
    const fromHint = decideUcpCartTransfer({
      merchant: { shared_cart_enabled: true },
      signedAgentReadsEnabled: true,
    });
    const fromGrant = decideUcpCartTransfer({
      merchant: { premium_features: ['shared_cart'] },
      signedAgentReadsEnabled: true,
    });
    const revoked = decideUcpCartTransfer({
      merchant: { premium_features: [], shared_cart_enabled: true },
      signedAgentReadsEnabled: true,
    });

    expect(fromHint).toEqual(fromGrant);
    // A raw grant list stays authoritative over a stale hint, as the cart
    // routes' live gate reads the raw grant.
    expect(revoked.ready).toBe(false);
  });
});
```

- [ ] **Step 2: Turn the F34 known gap into a real test, and enroll the conformance merchant**

1. In `apps/web/src/lib/agentic/fixtures/ucp-conformance.test.ts`, delete the comment line `// Roadmap Task 3 (plan 3) withholds cart when shared_cart_enabled is off.` and change `it.fails('F34: the cart capability follows shared_cart_enabled'` to `it('F34: the cart capability follows shared_cart_enabled'`.
2. In the same test's `buildProfile({ ...MERCHANT, shared_cart_enabled: false } as ManifestMerchant)`, drop the `as ManifestMerchant` cast. The type now has the field, and if the cast is needed, the manifest change is wrong. If `ManifestMerchant` becomes unused in that file, remove it from the import.
3. In `apps/web/src/lib/agentic/fixtures/ucp-conformance-data.ts`, add `shared_cart_enabled: true,` to `MERCHANT`, after `paystack_subaccount_code`. The F7 test expects cart in the profile, and Ogabassey is enrolled in production.

- [ ] **Step 3: Run the tests and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/decide-ucp-cart-transfer.test.ts src/lib/agentic/fixtures
```

Expected:
- the decision test fails because the module does not exist;
- F34 fails because cart is still declared when `shared_cart_enabled` is `false`;
- TypeScript itself is not checked by Vitest; Step 8 runs `tsc`.

- [ ] **Step 4: Create the decision module and the capability constant**

Create `apps/web/src/lib/agentic/decide-ucp-cart-transfer.ts`:

```ts
import {
  type MerchantFeatureSource,
  merchantHasFeature,
} from '@/lib/merchant-has-feature';

export type UcpCartTransferReadinessReason =
  | 'shared_cart_not_enrolled'
  | 'signed_agent_access_unavailable';

/**
 * Decides whether a merchant's UCP profile may declare cart transfer. Only
 * the canonical shared cart issues a redeemable handoff; the legacy fallback
 * links to `?agentic_cart_id=`, which nothing reads (F34). Cart transfer is
 * independent of native checkout and implies no payment capability.
 */
export function decideUcpCartTransfer({
  merchant,
  signedAgentReadsEnabled,
}: {
  merchant: MerchantFeatureSource;
  signedAgentReadsEnabled: boolean;
}): { ready: boolean; reasons: UcpCartTransferReadinessReason[] } {
  const reasons: UcpCartTransferReadinessReason[] = [];
  if (!signedAgentReadsEnabled) {
    reasons.push('signed_agent_access_unavailable');
  }
  if (!merchantHasFeature(merchant, 'shared_cart')) {
    reasons.push('shared_cart_not_enrolled');
  }
  return { ready: reasons.length === 0, reasons };
}
```

In `apps/web/src/lib/agentic/ucp-profile-constants.ts`, add at the end:

```ts

/** Agent-manifest capability that lets the UCP profile declare cart. */
export const CART_TRANSFER_CAPABILITY = 'cart.transfer';
```

- [ ] **Step 5: Grant `cart.transfer` in the manifest**

In `apps/web/src/lib/agentic/agent-commerce-manifest.ts`:

1. Add imports:

```ts
import { decideUcpCartTransfer } from '@/lib/agentic/decide-ucp-cart-transfer';
import { CART_TRANSFER_CAPABILITY } from '@/lib/agentic/ucp-profile-constants';
```

2. Add `| 'shared_cart_enabled'` to the `MerchantPaymentConfig` pick, after `| 'paystack_subaccount_configured'`. The cached storefront merchant already carries this hint. It is derived from the same `premium_features` entry that the cart routes' live gate reads, and the cache-invalidation triggers fire on `premium_features` changes (`supabase/migrations/20260727110000_complete_cache_invalidation_trigger_coverage.sql`).
3. After `const orderLinks = …;`, add:

```ts
  const cartTransfer = decideUcpCartTransfer({
    merchant,
    signedAgentReadsEnabled,
  });
```

4. In `capabilities: [ … ]`, after the `order.read` spread, add:

```ts
      ...(cartTransfer.ready ? [CART_TRANSFER_CAPABILITY] : []),
```

- [ ] **Step 6: Make the UCP profile follow `cart.transfer`**

In `apps/web/src/lib/agentic/ucp-shopping-profile.ts`:

1. Add `CART_TRANSFER_CAPABILITY,` to the `@/lib/agentic/ucp-profile-constants` import.
2. Replace `hasCartCapability` with:

```ts
function hasCartCapability(manifest: AgentCommerceManifest): boolean {
  // The manifest grants cart.transfer only for signed agent access to a
  // merchant enrolled in shared cart (decide-ucp-cart-transfer.ts). Cart
  // transfer is independent of native checkout and declares no payment.
  return manifest.capabilities.includes(CART_TRANSFER_CAPABILITY);
}
```

- [ ] **Step 7: Run the tests and update the ones that expected cart without enrollment**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/.well-known src/app/api/agentic mcp-server
```

Expected: the new decision test, F7 and F34 pass. Each test below fails only because it expects cart from a merchant or manifest that is not enrolled. Update each one exactly as described, without weakening any other assertion:

| Test file | Change |
| --- | --- |
| `src/lib/agentic/ucp-shopping-profile.test.ts` | In `advertises cart transfer independently of native checkout readiness`, change `capabilities: ['catalog.read']` to `capabilities: ['catalog.read', 'cart.transfer']`. Add `'cart.transfer'` to the capabilities that `signedManifest()` returns. Add a test that a manifest with `auth: checkoutAuth` and `capabilities: ['catalog.read']` gets no `dev.ucp.shopping.cart`. |
| `src/lib/agentic/ucp-discovery-profile.test.ts` | Add `'cart.transfer'` to the capabilities of each hand-built manifest whose test expects `dev.ucp.shopping.cart`. |
| `src/app/.well-known/ucp/route.test.ts` | Add `shared_cart_enabled: true` to the merchant that the mocked storefront resolution returns in the test that expects cart. Add a test that the same merchant with `shared_cart_enabled: false` gets no `dev.ucp.shopping.cart`. |
| `src/lib/agentic/agent-commerce-manifest.test.ts` | Add a test: the `builds checkout links…` merchant plus `shared_cart_enabled: true` has `cart.transfer` in `capabilities`, and without it does not. If the file is over 300 lines, put the test in `agent-commerce-manifest-dva-pause.test.ts`'s sibling, a new `agent-commerce-manifest-cart.test.ts`, with the same env setup. |

Rerun the command and repeat until there are no failures. If another test fails for a different reason, stop and report it; do not change it.

- [ ] **Step 8: Typecheck the web project once**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec tsc --noEmit -p tsconfig.json --incremental false; echo "tsc exit=$?"
```

Expected: `tsc exit=0`.

- [ ] **Step 9: Format, check and commit**

Format all files changed in this task with `./node_modules/.bin/biome check --write`, run `bash ci_scripts/quality-gate-missing-tests.sh`, stage exactly those files and commit:

```
fix(agentic): declare UCP cart only for shared-cart merchants

The manifest grants cart.transfer only when signed agent access is configured
and the merchant is enrolled in shared cart, and the UCP profile declares
cart from it. A merchant that is not enrolled no longer hands agents an
unredeemable ?agentic_cart_id= link (F34).
```

---

### Task 4: The cart routes fail closed for merchants not enrolled in shared cart (F34, routes)

**Files:**
- Create: `apps/web/src/lib/agentic/is-ucp-shared-cart-enabled.ts` (+ test), `apps/web/src/lib/agentic/ucp-cart-availability.ts` (+ test), `apps/web/src/lib/agentic/ucp-cart-route-support.test.ts`, `apps/web/src/app/api/agentic/carts/route-shared-cart-gate.test.ts`, `apps/web/src/app/api/agentic/carts/[id]/shared-cart-gate.test.ts`
- Modify: `apps/web/src/lib/agentic/ucp-canonical-cart.ts`, `apps/web/src/lib/agentic/ucp-cart-route-support.ts`, `apps/web/src/app/api/agentic/carts/route.ts`, and five existing route tests

- [ ] **Step 1: Write the reader and gate tests**

Create `apps/web/src/lib/agentic/is-ucp-shared-cart-enabled.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/cart/merchant-resolution', () => ({
  createAnonMerchantFeatureLookup: vi.fn(),
}));

function mockFeatures(features: unknown) {
  vi.mocked(createAnonMerchantFeatureLookup).mockReturnValue(
    vi.fn(async () => features) as never
  );
}

describe('isUcpSharedCartEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when the merchant holds the shared_cart grant', async () => {
    mockFeatures({ premium_features: ['shared_cart'] });
    await expect(isUcpSharedCartEnabled('merchant-1')).resolves.toBe(true);
  });

  it('is false without the grant', async () => {
    mockFeatures({ premium_features: [] });
    await expect(isUcpSharedCartEnabled('merchant-1')).resolves.toBe(false);
  });

  it('throws when the merchant cannot be read, so callers fail closed', async () => {
    mockFeatures(null);
    await expect(isUcpSharedCartEnabled('merchant-1')).rejects.toThrow(
      'Merchant unavailable'
    );
  });
});
```

Create `apps/web/src/lib/agentic/ucp-cart-availability.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';
import { checkUcpCartAvailability } from './ucp-cart-availability';

vi.mock('./is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

describe('checkUcpCartAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a merchant enrolled in shared cart', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(true);
    await expect(checkUcpCartAvailability('merchant-1')).resolves.toEqual({
      ok: true,
    });
  });

  it('answers 404 cart_unavailable for a merchant not enrolled', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(false);

    const result = await checkUcpCartAvailability('merchant-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(404);
    await expect(result.response.json()).resolves.toEqual({
      code: 'cart_unavailable',
      error: 'Cart transfer is not available for this store',
    });
  });

  it('answers 503 when enrollment cannot be read', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockRejectedValue(
      new Error('Merchant unavailable')
    );

    const result = await checkUcpCartAvailability('merchant-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      code: 'cart_availability_unknown',
      error: 'Cart availability could not be checked',
    });
  });
});
```

- [ ] **Step 2: Write the route-level gate tests**

Create `apps/web/src/lib/agentic/ucp-cart-route-support.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';
import { resolveUcpCartContext } from './ucp-cart-route-support';

vi.mock('./is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(),
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContextFromRpc: vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    id: 'merchant-1',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  })),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(() => ({})),
}));

const request = () =>
  new NextRequest('http://localhost/api/agentic/carts/cart_123');

describe('resolveUcpCartContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the scoped context for a shared-cart merchant', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(true);

    const context = await resolveUcpCartContext(request());

    expect(context.ok).toBe(true);
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
  });

  it('fails closed before creating a scoped client when the merchant is not enrolled', async () => {
    vi.mocked(isUcpSharedCartEnabled).mockResolvedValue(false);

    const context = await resolveUcpCartContext(request());

    expect(context.ok).toBe(false);
    if (context.ok) return;
    expect(context.response.status).toBe(404);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });
});
```

Create `apps/web/src/app/api/agentic/carts/route-shared-cart-gate.test.ts`. Copy lines 1–80 of the sibling `route.test.ts` unchanged: the imports, `mockVerifyAgenticApiKey`, `mockResolveAgenticMerchantContext`, every `vi.mock` and `mockMutation`. Then add this mock below the copied ones, and this test:

```ts
vi.mock('@/lib/agentic/is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(async () => false),
}));

describe('POST /api/agentic/carts shared-cart gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutation({
      currency: 'NGN',
      line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
    });
  });

  it('fails closed before reserving keys or writing a cart', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts', { method: 'POST' })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'cart_unavailable',
    });
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(handleCanonicalUcpCart).not.toHaveBeenCalled();
  });
});
```

Add `import { POST } from './route';` with the imports. Delete any copied import Biome reports as unused, such as `calculateCheckoutSession` or `storeAgenticIdempotencyResponse`. If the body shape `{ currency, line_items }` does not match how `route.test.ts` builds a valid create body, use the body from its first passing create test instead.

Create `apps/web/src/app/api/agentic/carts/[id]/shared-cart-gate.test.ts`. Copy lines 1–68 of the sibling `route-update.test.ts` unchanged, from the imports through the `@/lib/supabase/anon` mock. Then add:

```ts
vi.mock('@/lib/agentic/ucp-cart-checkout-conversion', () => ({
  convertUcpCartToCheckout: vi.fn(),
}));

vi.mock('@/lib/agentic/is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(async () => false),
}));

const props = { params: Promise.resolve({ id: 'cart_123' }) };
const url = 'http://localhost/api/agentic/carts/cart_123';
const mutation = {
  agentId: 'openai-agent',
  apiVersion: '2026-04-30',
  body: {},
  idempotencyKey: 'idem-1',
  method: 'POST',
  ok: true as const,
  pathname: '/api/agentic/carts/cart_123',
  rawBody: '{}',
  requestId: 'req-1',
};

async function expectGated(response: Response) {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    code: 'cart_unavailable',
  });
  expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
  expect(reserveAgenticRequestId).not.toHaveBeenCalled();
  expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  expect(handleCanonicalUcpCart).not.toHaveBeenCalled();
}

describe('per-cart routes shared-cart gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAgenticMutationRequest).mockResolvedValue(mutation as never);
    vi.mocked(readAgenticQueryRequest).mockResolvedValue({
      agentId: 'openai-agent',
      ok: true,
    } as never);
  });

  it('fails a cart read closed', async () => {
    await expectGated(await GET(new NextRequest(url), props));
  });

  it('fails a cart update closed before reserving keys', async () => {
    await expectGated(
      await POST(new NextRequest(url, { method: 'POST' }), props)
    );
  });

  it('fails a cart cancel closed before reserving keys', async () => {
    await expectGated(
      await cancelCart(
        new NextRequest(`${url}/cancel`, { method: 'POST' }),
        props
      )
    );
  });

  it('fails a cart-to-checkout conversion closed', async () => {
    await expectGated(
      await convertCart(
        new NextRequest(`${url}/checkout`, { method: 'POST' }),
        props
      )
    );
  });
});
```

Add these imports:

```ts
import { readAgenticQueryRequest } from '@/lib/agentic/mutation-request';
import { POST as cancelCart } from './cancel/route';
import { POST as convertCart } from './checkout/route';
import { GET, POST } from './route';
```

Merge the first into the existing `@/lib/agentic/mutation-request` import, and delete copied imports Biome reports as unused. If the update or cancel route rejects `body: {}` before the gate, look at the order in that route: the gate runs inside `resolveUcpCartContext`. If a route validates the body first, give the mutation a body that passes that validation, copied from that route's existing test. Do not move the gate after any reservation.

- [ ] **Step 3: Run the tests and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/is-ucp-shared-cart-enabled.test.ts src/lib/agentic/ucp-cart-availability.test.ts src/lib/agentic/ucp-cart-route-support.test.ts src/app/api/agentic/carts/route-shared-cart-gate.test.ts "src/app/api/agentic/carts/[id]/shared-cart-gate.test.ts"
```

Expected:
- the first two fail because their modules do not exist;
- the route tests fail because nothing gates them, so a key is reserved or a scoped client is created.

- [ ] **Step 4: Create the reader and the gate**

Create `apps/web/src/lib/agentic/is-ucp-shared-cart-enabled.ts`:

```ts
import { createAnonMerchantFeatureLookup } from '@/lib/cart/merchant-resolution';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { createAnonClient } from '@/lib/supabase/anon';

/**
 * Reads the merchant's live shared-cart enrollment. The canonical UCP cart
 * and the cart routes' availability gate share this reader, so both decide
 * from the same premium_features grant. Throws when the merchant cannot be
 * read; callers fail closed.
 */
export async function isUcpSharedCartEnabled(
  merchantId: string
): Promise<boolean> {
  const features = await createAnonMerchantFeatureLookup(createAnonClient())(
    merchantId
  );
  if (!features) throw new Error('Merchant unavailable');
  return merchantHasFeature(features, 'shared_cart');
}
```

Create `apps/web/src/lib/agentic/ucp-cart-availability.ts`:

```ts
import { NextResponse } from 'next/server';
import { isUcpSharedCartEnabled } from '@/lib/agentic/is-ucp-shared-cart-enabled';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

/**
 * Fails a UCP cart route closed unless the merchant is enrolled in shared
 * cart. Routes call it before reserving any idempotency key or request ID, so
 * a refused call leaves no reservation or legacy cart row behind (F34).
 */
export async function checkUcpCartAvailability(
  merchantId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  let enabled: boolean;
  try {
    enabled = await isUcpSharedCartEnabled(merchantId);
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      merchantId,
      message: 'UCP cart availability check failed',
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: 'cart_availability_unknown',
          error: 'Cart availability could not be checked',
        },
        { status: 503 }
      ),
    };
  }
  if (enabled) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        code: 'cart_unavailable',
        error: 'Cart transfer is not available for this store',
      },
      { status: 404 }
    ),
  };
}
```

- [ ] **Step 5: Wire the gate in**

1. In `apps/web/src/lib/agentic/ucp-canonical-cart.ts`, replace the `enabled: async (id: string) => { … },` entry of `defaults` with `enabled: isUcpSharedCartEnabled,`. Add `import { isUcpSharedCartEnabled } from './is-ucp-shared-cart-enabled';` and delete the now-unused imports of `createAnonMerchantFeatureLookup`, `merchantHasFeature` and `createAnonClient`.
2. In `apps/web/src/lib/agentic/ucp-cart-route-support.ts`, add `import { checkUcpCartAvailability } from '@/lib/agentic/ucp-cart-availability';`. In `resolveUcpCartContext`, between the `if (!agentAccess.ok) { … }` block and the final `return { merchant, ok: true, … }`, insert:

```ts
  const availability = await checkUcpCartAvailability(merchant.id);
  if (!availability.ok) {
    return { ok: false, response: availability.response };
  }
```

3. In `apps/web/src/app/api/agentic/carts/route.ts`, add the same import. Directly after

```ts
  if (!agentAccess.ok) {
    return NextResponse.json({ error: agentAccess.error }, { status: 403 });
  }
```

insert:

```ts

  const availability = await checkUcpCartAvailability(merchant.id);
  if (!availability.ok) return availability.response;
```

This has to come before `createAgenticScopedSupabaseClient` and `reserveAgenticIdempotencyKey`. The route inserts the legacy row before it calls `handleCanonicalUcpCart`, so a gate that only reacted to a `null` result would leave an orphan cart.

4. Check the four per-cart routes:

```bash
grep -n "resolveUcpCartContext\|reserveAgenticIdempotencyKey\|reserveAgenticRequestId" "src/app/api/agentic/carts/[id]/route.ts" "src/app/api/agentic/carts/[id]/cancel/route.ts" "src/app/api/agentic/carts/[id]/checkout/route.ts"
```

Expected: in every handler, `resolveUcpCartContext` appears on an earlier line than any reservation. If one does not, stop and report it.

- [ ] **Step 6: Keep the existing route tests on the enrolled path**

Add this block after the existing `vi.mock(...)` calls in each of the five files below. Their merchants are meant to be enrolled; without the mock, the real reader runs against the mocked anon client and the gate answers 503:

```ts
vi.mock('@/lib/agentic/is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(async () => true),
}));
```

- `src/app/api/agentic/carts/route.test.ts`
- `src/app/api/agentic/carts/[id]/route.test.ts`
- `src/app/api/agentic/carts/[id]/route-update.test.ts`
- `src/app/api/agentic/carts/[id]/cancel/route.test.ts`
- `src/app/api/agentic/carts/[id]/checkout/route.test.ts`

- [ ] **Step 7: Run the tests**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/api/agentic mcp-server
wc -l src/app/api/agentic/carts/route.ts src/lib/agentic/ucp-cart-route-support.ts src/lib/agentic/ucp-canonical-cart.ts
```

Expected: everything passes, and each file has at most 300 lines.

Another test may exercise the real cart routes or `resolveUcpCartContext` with a mocked anon client, for example under `mcp-server`. Add the same enrolled mock to it and name it in your report.

- [ ] **Step 8: Format, check and commit**

Format every file changed in this task, run `bash ci_scripts/quality-gate-missing-tests.sh`, stage exactly those files and commit:

```
fix(agentic): fail the UCP cart routes closed without shared cart

Create, read, update, cancel and checkout conversion now check shared-cart
enrollment before reserving any idempotency key or request ID. A merchant
that is not enrolled gets 404 cart_unavailable, and an unreadable merchant
gets 503, so no route emits the unredeemable ?agentic_cart_id= link (F34).
The canonical cart and the gate share one enrollment reader.
```

---

### Task 5: The OpenAI feed opts no product into native checkout (F6, feed)

**Files:**
- Create: `apps/web/src/config/openai-legacy-feed-eligibility.ts`
- Modify: `apps/web/src/app/api/feed/openai/legacy-feed-generator.ts`, `apps/web/src/app/api/feed/openai/legacy-feed-generator.test.ts`

- [ ] **Step 1: Check who reads the flag**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
grep -rn "enable_checkout\|is_eligible_checkout" apps packages docs --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" | grep -v node_modules
```

Expected: `apps/web/src/app/api/feed/openai/legacy-feed-generator.ts`, `feed-types.ts` and tests. Nothing in Baci reads the flag back; its consumer is OpenAI. If anything else reads it, stop and report it.

- [ ] **Step 2: Write the failing test**

At the end of the `describe('generateOpenAIFeed', …)` block in `apps/web/src/app/api/feed/openai/legacy-feed-generator.test.ts`, add:

```ts
  it('keeps search on and opts no row into native checkout (F6)', () => {
    const lines = generateOpenAIFeed(
      [
        product({ manage_stock: false, stock: 0 }),
        product({
          id: 'product-2',
          manage_stock: false,
          slug: 'variant-phone',
          variants: [
            {
              id: 'variant-1',
              sku: 'SKU-RED',
              attributes: { color: 'Red' },
              stock_quantity: 0,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );
    const rows = lines.map(parseLine);

    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        enable_checkout: false,
        enable_search: true,
      });
    }
  });
```

Run it:

```bash
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/feed/openai/legacy-feed-generator.test.ts
```

Expected: FAIL, because `enable_checkout` is `true`.

- [ ] **Step 3: Add the constant and use it**

Create `apps/web/src/config/openai-legacy-feed-eligibility.ts`:

```ts
/**
 * OpenAI product-feed eligibility for every legacy feed row. Search stays on.
 * Checkout stays off: OpenAI enables native checkout per approved integration
 * and no Baci merchant has one recorded, so opting a row in would claim a
 * checkout OpenAI cannot use (F6). `enable_search` and `enable_checkout` are
 * the accepted aliases of `is_eligible_search` and `is_eligible_checkout`
 * (https://developers.openai.com/commerce/specs/file-upload/products).
 */
export const OPENAI_LEGACY_FEED_ELIGIBILITY = {
  enable_checkout: false,
  enable_search: true,
} as const;
```

In `apps/web/src/app/api/feed/openai/legacy-feed-generator.ts`, add `import { OPENAI_LEGACY_FEED_ELIGIBILITY } from '@/config/openai-legacy-feed-eligibility';`. In both item builders (`buildVariantFeedItem` and `buildSimpleFeedItem`), replace

```ts
    enable_search: true,
    enable_checkout: true,
```

with `...OPENAI_LEGACY_FEED_ELIGIBILITY,`.

- [ ] **Step 4: Run the feed tests**

```bash
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/feed/openai src/app/feeds
```

Expected: PASS. If an existing test pinned `enable_checkout: true`, change it to `false` and name it in your report.

- [ ] **Step 5: Format, check and commit**

Format the three files, stage them and any changed test, and commit:

```
fix(feed): stop opting OpenAI feed rows into native checkout

Every legacy feed row now says enable_checkout: false and keeps
enable_search: true. OpenAI checkout needs a separately approved
integration that no Baci merchant has, so the old true claimed a checkout
OpenAI could not use (F6).
```

---

### Task 6: Full affected checks

**Files:** none, unless a check finds a problem.

- [ ] **Step 1: Run the affected suites, typecheck and lint**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic src/app/api/agentic src/app/.well-known src/app/api/feed/openai src/app/feeds mcp-server tools/cost/storefront-edge-inventory-snapshot.repository.test.ts
npm_config_verify_deps_before_run=false pnpm exec tsc --noEmit -p tsconfig.json --incremental false; echo "tsc exit=$?"
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
TURBO_SCM_BASE=$(git merge-base HEAD origin/main) npm_config_verify_deps_before_run=false pnpm turbo lint --affected
```

Expected:
- **Tests:** all pass. Compared with Task 0, there are two fewer expected failures (F7 and F34), and the new tests have been added.
- **Typecheck:** `tsc exit=0`.
- **Lint:** succeeds.

- [ ] **Step 2: Check the edge inventory**

The inventory test rebuilds the inventory from committed source. This plan edits `carts/route.ts`, so check whether that route is in the inventory:

```bash
grep -n "agentic/carts" apps/web/tools/cost/storefront-edge-api-source-allowlist.ts
```

If it prints nothing and Step 1's inventory test passed, there is nothing to do. If the inventory test failed with `inventory snapshot does not match committed source`, regenerate it exactly as plan 1 Task 8 Steps 8–10 do:
- Run the generator with `--source-sha "$(git rev-parse HEAD)"`.
- The row count stays 585.
- Update `snapshotSha256` in `storefront-edge-inventory-snapshot.repository.test.ts`.
- Commit `chore(cost): regenerate edge inventory after cart gate`.

---

### Task 7: Record the limitations and re-review the register (last)

The register's `agent-protocols` row binds `ucp-shopping-profile.ts`, `agent-commerce-manifest.ts`, `carts/route.ts` and `carts/[id]/checkout/route.ts`, so the gate fails until the row is re-reviewed. This plan also changes what is true, so the row's limitations and the access-map cells change too.

This task runs last, on the final code commit. Redo it after any rebase or merge.

**Files:** `docs/product/baci-capabilities.json`, `docs/product/agent-access-map.md`

- [ ] **Step 1: Run the gate and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
git status --short
BASE_SHA=$(git rev-parse origin/main) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py; echo "gate exit=$?"
```

Expected: a clean tree, then `capability sources changed without a register re-review…` and `gate exit=1`.

- [ ] **Step 2: Stamp the register, the limitations, the map and the digests**

The script records `HEAD`, so the tree must be clean. It:
- sets the row's `limitations` and the register's `reviewed_at`, `source_revision` and `review_scope`;
- rewrites the map header;
- writes `HEAD` into every Source revision cell;
- replaces the cells this plan made untrue;
- re-dates the four Local test cells, which still pin Task 4 gaps and stay `fail`.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims
RESTAMP="${TMPDIR:-/tmp}/agentic-m0-3-restamp.py"
cat > "$RESTAMP" <<'PY'
import datetime as dt
import json
import pathlib
import re
import subprocess
import textwrap

rev = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
stamp = now.strftime("%Y-%m-%dT%H:%M:%S+00:00")
day = f"{now.day} {now:%B} {now.year}"
test_day = now.strftime("%Y-%m-%d")

register_path = pathlib.Path("docs/product/baci-capabilities.json")
register = json.loads(register_path.read_text())
row = next(c for c in register["capabilities"] if c["id"] == "agent-protocols")
row["limitations"] = (
    "Protocol implementation is not certification, partner approval or universal "
    "merchant activation. Discovery is merchant-scoped and capability-gated; checkout "
    "requires readiness, signed authorization and enabled payment configuration. UCP "
    "cart is declared and served only for merchants enrolled in shared cart, and cart "
    "update (PUT /carts/{id}) is not supported, matching Google's create-only cart "
    "transfer. Google Pay is not advertised to agents, because completion would create "
    "a Paystack bank transfer instead of charging the token, and the OpenAI product "
    "feed opts no product into native checkout. Do not claim automatic ChatGPT/Google "
    "shopping inclusion, independently executable Google Pay, unconstrained autonomous "
    "payments or complete current-spec conformance without separate verification. The "
    "future-of-commerce mission is positioning, not measured impact."
)
register["reviewed_at"] = stamp
register["source_revision"] = rev
register["review_scope"] = (
    "Source evidence only. Re-reviewed agent-protocols after its capability claims "
    "were made truthful: every UCP shopping capability declares its schema, the "
    "catalog specs point at the search and lookup pages, cart is declared and served "
    "only for shared-cart merchants, Google Pay is no longer advertised and the OpenAI "
    "legacy feed opts no product into native checkout. The claim and status are "
    "unchanged; the limitations now record the create-only cart, the shared-cart "
    "condition, the withheld Google Pay and the feed. The support-chat health probe, "
    "OAuth connected discovery, anonymous compatibility and refresh receipts retain "
    "their prior review. New-endpoint conversational and native acceptance remain "
    "pending. No production promotion; deployment and transaction readiness require "
    "separate verification."
)
register_path.write_text(json.dumps(register, indent=2, ensure_ascii=False) + "\n")

map_path = pathlib.Path("docs/product/agent-access-map.md")
text = map_path.read_text()
body = (
    f"`{rev}`. Capability claims were made truthful: UCP declarations carry their "
    "schemas, cart follows shared-cart enrollment, Google Pay is withheld and the "
    "OpenAI feed opts no product into native checkout. This is a navigation map, not "
    "authorization or proof of current deployment. Check the current implementation, "
    "live tool discovery and merchant entitlement before calling or claiming a tool."
)
header = f"Reviewed {day} against source revision\n{textwrap.fill(body, 80)}\n\n"
text, count = re.subn(r"(?s)(?<=\n\n)Reviewed .*?\n\n", lambda m: header, text, count=1)
assert count == 1, "header"

replacements = {
    ("Google UCP cart", 10): (
        "Storefront carts, for a merchant enrolled in shared cart only: "
        "`apps/web/src/lib/agentic/decide-ucp-cart-transfer.ts` withholds cart otherwise "
        "and `apps/web/src/lib/agentic/ucp-cart-availability.ts` fails the cart routes "
        "closed (F34). Google treats every free-listing product as cart-eligible until the "
        "feed sends per-product `native_commerce(cart_eligibility)` flags (F25, roadmap "
        "Task 8). Update via `PUT /carts/{id}` is not supported (F15)"
    ),
    ("Paystack-hosted Google Pay", 2): (
        "Not advertised: `apps/web/src/lib/agentic/decide-agentic-payment-methods.ts` "
        "marks Google Pay not ready, so neither the agent manifest nor `/.well-known/ucp` "
        "lists `com.google.pay`; Google's current handler is versioned `2026-01-23` with a "
        "different config"
    ),
    ("Paystack-hosted Google Pay", 10): (
        "None: Google Pay is withheld from every discovery surface because UCP completion "
        "would create a Paystack dedicated virtual account instead of charging the token; "
        "a direct completion that names `google_pay` is still processed as a bank transfer "
        "(roadmap Task 13)"
    ),
    ("ACP direct checkout", 10): (
        "Merchant products the checkout quote can price; used and refurbished eligibility "
        "is not evidenced (roadmap Task 8); the OpenAI feed opts no product into native "
        "checkout (`enable_checkout: false`, F6)"
    ),
}
local_labels = {
    "OpenAI MCP handoff",
    "ACP direct checkout",
    "Google UCP cart",
    "Multi-merchant onboarding",
}
lines = text.split("\n")
start = lines.index("## Agent surface evidence")
seen = set()
for index in range(start + 1, len(lines)):
    line = lines[index]
    if line.startswith("## "):
        break
    if not line.startswith("| ") or line.startswith(("| Surface ", "| ---")):
        continue
    cells = line[2:-2].split(" | ")
    surface = cells[0]
    cells[4] = rev
    if surface in local_labels:
        cells[5] = re.sub(r"^fail \d{4}-\d{2}-\d{2}", f"fail {test_day}", cells[5])
    for (name, column), value in replacements.items():
        if name == surface:
            cells[column] = value
            seen.add((name, column))
    lines[index] = "| " + " | ".join(cells) + " |"
assert seen == set(replacements), sorted(set(replacements) - seen)
map_path.write_text("\n".join(lines))
print(f"reviewed_at={stamp}\nsource_revision={rev}")
PY
python3 "$RESTAMP"
python3 vps-workers/baci-editorial-context/register_digests.py --write
git diff --stat
```

Expected:
- the script prints `reviewed_at=…` and a 40-character `source_revision`;
- the digest tool prints both digests;
- `git diff --stat` touches only the two docs.

Before going on, open the diff:
- If `json.dumps` reformatted `baci-capabilities.json` beyond the changed fields, the file is not two-space JSON. Restore it with `git checkout -- docs/product/baci-capabilities.json` and make the same four edits with targeted regex substitutions instead, as plan 2 Task 8 does.
- If the four Local test cells did not start with `fail <date>`, stop and report: a known gap may have been fixed elsewhere.

- [ ] **Step 3: Validate the table and commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-3-truthful-claims/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/evidence
cd ..
cd ..
git add docs/product/baci-capabilities.json docs/product/agent-access-map.md
LEFTHOOK_EXCLUDE=knip git commit -m "docs(capabilities): re-review agent protocols after truthful capability claims" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the evidence tests pass before the commit.

- [ ] **Step 4: Run the gate and the freshness check**

```bash
BASE_SHA=$(git rev-parse origin/main) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py; echo "gate exit=$?"
python3 vps-workers/baci-editorial-context/register_status.py
```

Expected:
- the gate's binding suite ends with `OK`, and the script prints `gate exit=0`;
- the freshness check prints `fresh`;
- lines from the suite's own negative tests, such as `cannot compute the changed-path set for base bbbbbbbbbbbb`, appear in the output and are not failures.

If the gate says `cited change not bound at source_revision: <path>`, a file changed after Step 2. Reset this commit with `git reset --hard HEAD~1`, but only if the last commit is this task's commit, and redo the task.

---

### Task 8: Hand over

- [ ] **Step 1: Report**

Report:
- the branch name;
- the commit that `source_revision` names (`git rev-parse HEAD~1`);
- the register commit;
- every test you changed beyond those this plan names, with the reason;
- the test totals before and after;
- whether CodeRabbit ran.

The orchestrator then:
1. Pushes with commit IDs intact.
2. Opens the pull request: against `main` in case A, or against `chore/agentic-baseline-evidence` in case B.
3. Asks `@codex review`.
4. Updates the tracker.

The pull request body lists the live changes from "What changes live when this plan merges" and the four owner decisions with the defaults taken.

---

## Self-review against the roadmap (Task 3)

| Roadmap bullet | Where |
| --- | --- |
| Google Pay omitted when completion only creates a DVA; DVA paused and unpaused, pay on delivery, missing secret, existing methods | Task 2: the decision test covers each case, and the manifest and UCP tests pin the omission |
| Feed: no native-checkout opt-in without proven ACP eligibility; search independent; consumers checked | Task 5 |
| Google cart conditional on a working, authorized handoff and a reviewed eligibility policy (F25) | Task 3: shared cart plus signed agent access. The policy is owner decision 2, recorded in Task 7. Ogabassey keeps cart, so existing traffic is unaffected. |
| F34: profile withholds cart without `shared_cart_enabled`; cart routes fail closed before reserving keys; `MerchantPaymentConfig` gains the flag; a flag change reaches both | Tasks 3 and 4. Both read the same `premium_features` grant through `merchantHasFeature`, and the snapshot is invalidated on `premium_features` changes. |
| F15: keep the declaration, record "update via `PUT` is not supported" in the limitations and the access map | Task 7 |
| Withdraw or correct anything Task 4 cannot make correct | Nothing is withdrawn now. Plans 4–6 own the unit, VAT and fulfillment fixes; revisit after them. |
| Fail-closed decisions with independent readiness reasons; Google Pay checkbox is not token charging; DVA replay controls preserved | Tasks 2–4. Completion, DVA pause and replay code are untouched. |
| F7: schema on cart and catalog | Task 1 |
