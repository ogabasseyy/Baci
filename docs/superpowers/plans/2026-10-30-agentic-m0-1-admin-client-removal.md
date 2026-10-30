# Agentic Milestone 0, Plan 1 of 6: Remove the Admin Client from Agentic Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user-facing agentic API route resolves its merchant through the scoped, server-minted context RPC instead of a service-role client, and checkout completion still receives the merchant's Paystack subaccount.

**Architecture:** The nine affected route handlers already read business data through a scoped agentic JWT client; only merchant resolution calls `createAdminClient()`. Each call switches to `resolveAgenticMerchantContextFromRpc()`, which the UCP cart routes already use. That projection deliberately withholds the Paystack subaccount, so checkout completion opts into a second RPC, `resolve_agentic_merchant_payment_split`, under the same slug-bound authority. A static guard test keeps the admin client out of `apps/web/src/app/api/agentic`.

**Tech Stack:** Next.js route handlers (TypeScript), Supabase PostgreSQL (`SECURITY DEFINER` SQL function and role grants), Vitest, psql in a throwaway Docker Postgres, the Python capability-register tools, pnpm/Turborepo and Biome.

**Roadmap:** [Task 2](2026-10-29-agentic-ucp-completion.md#task-2--remove-user-facing-admin-client-edges), findings F5 and F37. **Baseline:** `origin/main` at `1a17a9b900cf951d9df85973cdd1df6b28cd90b7`.

---

## Milestone 0 plan sequence

Each plan is one pull request. Land them one at a time: several edit files bound to the same capability-register row, so each regenerates the register digests on top of the previous one.

| Plan | Roadmap task | Pull request |
| --- | --- | --- |
| **1 (this plan)** | Task 2 | Remove the admin client from agentic routes |
| 2 | Task 1 | Baseline evidence; record whether `shared_cart_enabled` and VAT are on for the agentic merchant |
| 3 | Task 3 | Truthful capability claims and the shared-cart gate |
| 4 | Task 4 | Minor units and the confirmation contract |
| 5 | Task 4 | VAT guard and the VAT cutover procedure |
| 6 | Task 4 | Merchant-owned fulfillment and the F29 fixtures |

## Ground rules

- Work in a fresh worktree from `origin/main` (Task 1). The primary checkout has unrelated uncommitted work.
- Run pnpm tools as `npm_config_verify_deps_before_run=false pnpm exec …`. Plain `pnpm exec` can start a full `pnpm install`, which has filled this machine's disk before.
- Do not edit `apps/web/src/proxy.ts`, `apps/web/src/config/business-types.ts` or any `.env*` file. Never edit an existing migration.
- Before every commit, run `coderabbit review --agent -t uncommitted` and fix valid critical or high findings. If CodeRabbit is unavailable, stop and report that; never claim a review ran.
- Pushing, opening the pull request, merging and deploying each need the owner's explicit go-ahead.

## Design decision: a separate payment-split function

The roadmap preferred restoring `paystack_subaccount_code` inside `resolve_agentic_merchant_context`. The existing test `supabase/tests/agentic_merchant_context_authority.sql` deliberately asserts that this projection never discloses it ("Payment identifier disclosed"), and the cart routes never need it. This plan keeps that guarantee and adds `resolve_agentic_merchant_payment_split`: same role, same JWT slug binding, one column. Only completion calls it, through `resolveAgenticMerchantContextFromRpc({ includePaymentSplit: true })`.

## Why the swap is safe for the other eight routes

| Field | Admin path today (`resolveAgenticMerchantContext`) | Scoped RPC (`resolveAgenticMerchantContextFromRpc`) |
| --- | --- | --- |
| `id`, `slug`, `business_name` | From `merchants` | Same columns |
| `custom_domain` | Primary active row in `domains` | Same filter, newest row wins |
| `agentic_checkout_enabled` | `true` when the settings row is missing; `false` when the read fails | `true` when the row is missing; the whole context is `null` when the RPC fails |
| `pay_on_delivery_enabled` | `true` only when set | Same |
| Agent allow and deny lists | `custom_settings` | Same keys, projected by the RPC |
| `paystack_subaccount_code` | Real value | Always `null`; only completion reads it, via the new RPC |

No handler other than completion reads `paystack_subaccount_code` (`checkout-session-complete-handler.ts:257` on the baseline).

## Scope

Covered: the nine `createAdminClient()` call sites, the completion payment split, the unused `bootstrap` argument, a guard against regressions, the migration and its registry entries, and the capability-register refresh.

Not covered: multi-merchant partner binding and partner-credential rotation. Today's authority (API key, signed request, one configured merchant slug, scoped JWT) is unchanged by this plan; partner-specific authentication belongs to roadmap Task 5. The existing route suites already cover missing and invalid credentials and must keep passing.

## File map

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `apps/web/src/app/api/agentic/admin-client-boundary.test.ts` | Fails if any non-test file under `app/api/agentic` imports the admin client |
| Create | `supabase/migrations/20261030140000_agentic_merchant_payment_split.sql` | Scoped payment-split function |
| Create | `supabase/tests/agentic_merchant_payment_split.sql` | Throwaway-database test for that function |
| Modify | `apps/web/tools/db/supabase-history-replay-cart-pending-sources.ts` | Register the migration hash |
| Modify | `apps/web/tools/db/expected-recent-cart-pending-sources.test-support.ts` | Expected registry fixture |
| Modify | `apps/web/tools/db/supabase-history-replay-cart-pending-sources.test.ts` | Fixture count 94 → 95 |
| Regenerate | `docs/superpowers/evidence/storefront-edge/task-1a-inventory.json` | Edge inventory; it binds the committed bytes of the agentic route files this plan edits |
| Modify | `apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts` | Expected `snapshotSha256` for the regenerated inventory |
| Modify | `apps/web/src/lib/agentic/merchant-context.ts` and `merchant-context.test.ts` | `includePaymentSplit` option; remove the admin-path resolver |
| Modify | `apps/web/src/app/api/agentic/catalog/{search,lookup,product}/route.ts` | Scoped merchant resolution |
| Modify | `apps/web/src/app/api/agentic/checkout_sessions/checkout-session-create-handler.ts` | Same |
| Modify | `apps/web/src/app/api/agentic/checkout_sessions/[id]/{route-get-handler,checkout-session-update-handler}.ts` | Same |
| Modify | `apps/web/src/app/api/agentic/checkout_sessions/[id]/cancel/route.ts` | Same |
| Modify | `apps/web/src/app/api/agentic/orders/[id]/route.ts` | Same |
| Modify | `apps/web/src/app/api/agentic/checkout_sessions/[id]/complete/checkout-session-complete-handler.ts` | Scoped resolution with the payment split |
| Modify | `apps/web/src/app/api/agentic/checkout_sessions/[id]/complete/checkout-session-complete-helpers.ts` | Drop the unused `bootstrap` input |
| Modify | 20 route test files listed in Tasks 6 and 7 | Mock the scoped resolver |
| Modify | `docs/product/baci-capabilities.json`, `docs/product/agent-access-map.md` | Re-reviewed provenance and digests |

---

### Task 1: Create the worktree

- [ ] **Step 1: Create a branch from current main**

```bash
cd /Users/mac/Baci-app
git fetch origin main
git worktree add .worktrees/agentic-m0-admin-client -b fix/agentic-remove-admin-client origin/main
cd .worktrees/agentic-m0-admin-client
```

- [ ] **Step 2: Check what changed since this plan was written**

```bash
git diff --stat 1a17a9b900cf951d9df85973cdd1df6b28cd90b7 HEAD -- apps/web/src/app/api/agentic apps/web/src/lib/agentic supabase/migrations apps/web/tools/db docs/product
```

Expected: no output. If files are listed, re-read each listed file that this plan edits before editing it, and pick a migration timestamp later than the newest file in `supabase/migrations/` (Task 3 uses `20261030140000`).

- [ ] **Step 3: Install dependencies**

```bash
df -h /System/Volumes/Data | tail -1
pnpm install --frozen-lockfile --prefer-offline
```

Expected: at least 20 GB free before installing; the install finishes without errors.

---

### Task 2: Write the failing guard test

**Files:**
- Create: `apps/web/src/app/api/agentic/admin-client-boundary.test.ts`

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const AGENTIC_ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_ONLY_FILE = /\.test\.tsx?$|test-support|test-helpers/;

function listRuntimeSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return listRuntimeSources(entryPath);
    return /\.tsx?$/.test(entry.name) && !TEST_ONLY_FILE.test(entry.name)
      ? [entryPath]
      : [];
  });
}

it('keeps the service-role admin client out of user-facing agentic routes', () => {
  const offenders = listRuntimeSources(AGENTIC_ROUTES_DIR)
    .filter((file) =>
      readFileSync(file, 'utf8').includes('@/lib/supabase/admin')
    )
    .map((file) => relative(AGENTIC_ROUTES_DIR, file))
    .sort();

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/agentic/admin-client-boundary.test.ts
```

Expected: FAIL. The received array lists exactly these nine files:

```
catalog/lookup/route.ts
catalog/product/route.ts
catalog/search/route.ts
checkout_sessions/[id]/cancel/route.ts
checkout_sessions/[id]/checkout-session-update-handler.ts
checkout_sessions/[id]/complete/checkout-session-complete-handler.ts
checkout_sessions/[id]/route-get-handler.ts
checkout_sessions/checkout-session-create-handler.ts
orders/[id]/route.ts
```

Leave this file uncommitted; Task 8 commits it once it passes.

---

### Task 3: Add the payment-split SQL function

**Files:**
- Create: `supabase/tests/agentic_merchant_payment_split.sql`
- Create: `supabase/migrations/20261030140000_agentic_merchant_payment_split.sql`

- [ ] **Step 1: Write the SQL test**

Create `supabase/tests/agentic_merchant_payment_split.sql` with exactly:

```sql
-- Run only in an empty disposable PostgreSQL database with psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,slug text,business_name text,paystack_subaccount_code text);
CREATE TABLE public.domains(id uuid,merchant_id uuid,domain text,is_primary boolean,status text,updated_at timestamptz,created_at timestamptz);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid,agentic_checkout_enabled boolean,pay_on_delivery_enabled boolean,custom_settings jsonb);
INSERT INTO public.merchants VALUES('11111111-1111-4111-8111-111111111111','ogabassey','Ogabassey','ACCT_ogabassey'),('22222222-2222-4222-8222-222222222222','other','Other','ACCT_other');
\ir ../migrations/20261015179995_agentic_merchant_context_authority.sql
\ir ../migrations/20261030140000_agentic_merchant_payment_split.sql
\ir ../migrations/20261030140000_agentic_merchant_payment_split.sql
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(r,'public.resolve_agentic_merchant_payment_split(text)','EXECUTE') THEN RAISE EXCEPTION 'Payment split executable by %',r; END IF;
 END LOOP;
 IF NOT has_function_privilege('agentic_merchant_context','public.resolve_agentic_merchant_payment_split(text)','EXECUTE') THEN RAISE EXCEPTION 'Context role cannot read the payment split'; END IF;
 IF has_table_privilege('agentic_merchant_context','public.merchants','SELECT') THEN RAISE EXCEPTION 'Direct merchants access'; END IF;
END $$;
SET LOCAL ROLE agentic_merchant_context;
SELECT set_config('request.jwt.claims','{"role":"agentic_merchant_context","agentic_merchant_slug":"ogabassey"}',true);
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.resolve_agentic_merchant_payment_split(' Ogabassey ');
 IF r.paystack_subaccount_code IS DISTINCT FROM 'ACCT_ogabassey' THEN RAISE EXCEPTION 'Bound payment split lookup failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_payment_split('other')) THEN RAISE EXCEPTION 'Cross slug payment split allowed'; END IF;
 SELECT * INTO r FROM public.resolve_agentic_merchant_context('ogabassey');
 IF r.paystack_subaccount_code IS NOT NULL THEN RAISE EXCEPTION 'Context projection discloses the payment identifier'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","agentic_merchant_slug":"ogabassey"}',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_payment_split('ogabassey')) THEN RAISE EXCEPTION 'Wrong JWT role accepted'; END IF; END $$;
RESET ROLE;
ROLLBACK;
```

The test includes the new migration twice on purpose: the second run proves the migration can safely be re-applied, as the existing `agentic_merchant_context_authority.sql` test does for its migration.

- [ ] **Step 2: Start a throwaway Postgres and watch the test fail**

The data directory lives in memory (`--tmpfs`) because Docker Desktop's own disk may be full; nothing is written to Docker's disk.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
docker run -d --name baci-agentic-sqltest -e POSTGRES_PASSWORD=postgres --tmpfs /var/lib/postgresql/data:rw,size=512m postgres:17
timeout 90 sh -c 'until docker exec baci-agentic-sqltest pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do :; done'
docker exec baci-agentic-sqltest mkdir -p /work
docker cp supabase baci-agentic-sqltest:/work/
docker exec baci-agentic-sqltest psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /work/supabase/tests/agentic_merchant_payment_split.sql
```

Expected: exit code 3 with `error: /work/supabase/migrations/20261030140000_agentic_merchant_payment_split.sql: No such file or directory`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261030140000_agentic_merchant_payment_split.sql` with exactly the content below and a single trailing newline. Do not add the words "concurrently", "vacuum" or "reindex" anywhere in this file: the deploy script scans for them.

```sql
-- Checkout completion needs the configured merchant's Paystack payment split.
-- The shared context projection keeps withholding it because cart routes never
-- need it. This function returns only that value, under the same server-minted,
-- slug-bound agentic_merchant_context authority.
CREATE OR REPLACE FUNCTION public.resolve_agentic_merchant_payment_split(
  p_slug text
)
RETURNS TABLE (
  paystack_subaccount_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT m.paystack_subaccount_code::text AS paystack_subaccount_code
  FROM public.merchants AS m
  WHERE auth.jwt()->>'role' = 'agentic_merchant_context'
    AND auth.jwt()->>'agentic_merchant_slug' = lower(trim(p_slug))
    AND p_slug IS NOT NULL
    AND octet_length(p_slug) <= 254
    AND m.slug = lower(trim(p_slug))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_agentic_merchant_payment_split(text) IS
  'Returns only the configured agentic merchant''s Paystack subaccount code for checkout completion, under the server-minted, slug-bound agentic_merchant_context authority.';

ALTER FUNCTION public.resolve_agentic_merchant_payment_split(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_agentic_merchant_payment_split(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_agentic_merchant_payment_split(text)
  TO agentic_merchant_context;
```

- [ ] **Step 4: Run the new test and the existing context test**

```bash
docker exec baci-agentic-sqltest rm -rf /work/supabase
docker cp supabase baci-agentic-sqltest:/work/
docker exec baci-agentic-sqltest psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /work/supabase/tests/agentic_merchant_payment_split.sql; echo "exit=$?"
docker exec baci-agentic-sqltest psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /work/supabase/tests/agentic_merchant_context_authority.sql; echo "exit=$?"
```

Expected: both print `exit=0` with no `ERROR` lines. A `NOTICE` about the existing role membership is normal.

- [ ] **Step 5: Remove the throwaway database**

```bash
docker rm -f baci-agentic-sqltest
```

---

### Task 4: Register the migration

**Files:**
- Modify: `apps/web/tools/db/supabase-history-replay-cart-pending-sources.ts`
- Modify: `apps/web/tools/db/expected-recent-cart-pending-sources.test-support.ts`
- Modify: `apps/web/tools/db/supabase-history-replay-cart-pending-sources.test.ts:9`

- [ ] **Step 1: Confirm the hash**

```bash
shasum -a 256 supabase/migrations/20261030140000_agentic_merchant_payment_split.sql
```

Expected: `769b93607eab5062a318176dc58b809649cf264c2516bd8792cff26364d63b3e`. If the value differs, the file is not byte-identical to Task 3 Step 3; use the printed value everywhere this plan shows the hash.

- [ ] **Step 2: Append the replay row**

In `apps/web/tools/db/supabase-history-replay-cart-pending-sources.ts`, replace the last line of `CART_PENDING_REPLAY_SOURCE_ROWS`:

```ts
258767d07ecdd594fb9c0b7df117646c7aae2da682c04ea60d86369d842f7fe0 20261029212802_redvault_checkout_reconciliation.sql`;
```

with:

```ts
258767d07ecdd594fb9c0b7df117646c7aae2da682c04ea60d86369d842f7fe0 20261029212802_redvault_checkout_reconciliation.sql
769b93607eab5062a318176dc58b809649cf264c2516bd8792cff26364d63b3e 20261030140000_agentic_merchant_payment_split.sql`;
```

- [ ] **Step 3: Append the expected fixture entry**

In `apps/web/tools/db/expected-recent-cart-pending-sources.test-support.ts`, replace:

```ts
  {
    repositoryPath:
      'supabase/migrations/20261029212802_redvault_checkout_reconciliation.sql',
    sha256: '258767d07ecdd594fb9c0b7df117646c7aae2da682c04ea60d86369d842f7fe0',
  },
] as const;
```

with:

```ts
  {
    repositoryPath:
      'supabase/migrations/20261029212802_redvault_checkout_reconciliation.sql',
    sha256: '258767d07ecdd594fb9c0b7df117646c7aae2da682c04ea60d86369d842f7fe0',
  },
  {
    repositoryPath:
      'supabase/migrations/20261030140000_agentic_merchant_payment_split.sql',
    sha256: '769b93607eab5062a318176dc58b809649cf264c2516bd8792cff26364d63b3e',
  },
] as const;
```

- [ ] **Step 4: Bump the fixture count**

In `apps/web/tools/db/supabase-history-replay-cart-pending-sources.test.ts`, change:

```ts
  expect(EXPECTED_CART_PENDING_SOURCES).toHaveLength(94);
```

to:

```ts
  expect(EXPECTED_CART_PENDING_SOURCES).toHaveLength(95);
```

- [ ] **Step 5: Run the registry suites**

These hash hundreds of Git objects and take a few minutes.

```bash
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run tools/db/supabase-history-replay-cart-pending-sources.test.ts tools/db/verify-supabase-history-replay-manifest.test.ts tools/db/supabase-history-replay-manifest.test.ts tools/db/verify-current-migration-registry.test.ts tools/events/verify-analytics-delivery-authority.repository.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit the migration, its test and its registration**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
coderabbit review --agent -t uncommitted
git add supabase/migrations/20261030140000_agentic_merchant_payment_split.sql supabase/tests/agentic_merchant_payment_split.sql apps/web/tools/db/supabase-history-replay-cart-pending-sources.ts apps/web/tools/db/expected-recent-cart-pending-sources.test-support.ts apps/web/tools/db/supabase-history-replay-cart-pending-sources.test.ts
git commit -m "feat(agentic): add scoped payment-split lookup for checkout completion"
```

Do not touch the edge-inventory snapshot here. Task 8 regenerates it once, after every route change is committed.

---

### Task 5: Read the payment split in the scoped resolver

**Files:**
- Modify: `apps/web/src/lib/agentic/merchant-context.ts`
- Test: `apps/web/src/lib/agentic/merchant-context.test.ts`

- [ ] **Step 1: Write the failing tests**

In `merchant-context.test.ts`, inside `describe('resolveAgenticMerchantContextFromRpc', () => {`, add these tests directly after the test named `'returns null when the RPC errors or resolves no merchant'`:

```ts
  it('reads the payment split through its own scoped RPC when asked', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [
          { id: 'merchant-1', slug: 'demo-store', paystack_subaccount_code: null },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ paystack_subaccount_code: 'ACCT_split' }],
        error: null,
      });

    const context = await resolveAgenticMerchantContextFromRpc({
      includePaymentSplit: true,
    });

    expect(mocks.contextRpc).toHaveBeenNthCalledWith(
      2,
      'resolve_agentic_merchant_payment_split',
      { p_slug: 'demo-store' }
    );
    expect(context).toMatchObject({
      id: 'merchant-1',
      paystack_subaccount_code: 'ACCT_split',
    });
  });

  it('does not read the payment split by default', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc.mockResolvedValueOnce({
      data: [{ id: 'merchant-1', slug: 'demo-store' }],
      error: null,
    });

    const context = await resolveAgenticMerchantContextFromRpc();

    expect(mocks.contextRpc).toHaveBeenCalledTimes(1);
    expect(context?.paystack_subaccount_code).toBeNull();
  });

  it('fails closed when the payment split RPC errors', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [{ id: 'merchant-1', slug: 'demo-store' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } });

    await expect(
      resolveAgenticMerchantContextFromRpc({ includePaymentSplit: true })
    ).resolves.toBeNull();
  });

  it('keeps a missing subaccount null so completion still answers 424', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [{ id: 'merchant-1', slug: 'demo-store' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ paystack_subaccount_code: null }],
        error: null,
      });

    const context = await resolveAgenticMerchantContextFromRpc({
      includePaymentSplit: true,
    });

    expect(context).toMatchObject({
      id: 'merchant-1',
      paystack_subaccount_code: null,
    });
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/merchant-context.test.ts
```

Expected: FAIL. The first test gets `paystack_subaccount_code: null` because the split RPC is never called, and the "fails closed" test resolves to the context instead of `null`. The "by default" and "missing subaccount" tests may already pass.

- [ ] **Step 3: Implement the option**

In `apps/web/src/lib/agentic/merchant-context.ts`, replace everything from `interface AgenticMerchantContextRpcClient {` through the closing `}` of `resolveAgenticMerchantContextFromRpc` with:

```ts
interface AgenticMerchantContextRpcClient {
  rpc(
    functionName:
      | 'resolve_agentic_merchant_context'
      | 'resolve_agentic_merchant_payment_split',
    args: { p_slug: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

type AgenticPaymentSplitResult =
  | { ok: true; paystackSubaccountCode: string | null }
  | { ok: false };

/**
 * Resolves the configured merchant through the narrowly scoped
 * SECURITY DEFINER projection instead of a service-role client, so
 * user-facing agentic routes never bypass RLS to read merchant config.
 * The projection withholds the Paystack subaccount; checkout completion
 * opts into the separate payment-split RPC with `includePaymentSplit`.
 */
export async function resolveAgenticMerchantContextFromRpc({
  includePaymentSplit = false,
}: {
  includePaymentSplit?: boolean;
} = {}): Promise<AgenticMerchantContext | null> {
  const merchantSlug = getConfiguredAgenticMerchantSlug();
  if (!merchantSlug) {
    return null;
  }
  const normalizedSlug = merchantSlug.trim().toLowerCase();
  const contextClient: AgenticMerchantContextRpcClient =
    createAgenticMerchantContextClient(normalizedSlug);
  const { data, error } = await contextClient.rpc(
    'resolve_agentic_merchant_context',
    {
      p_slug: normalizedSlug,
    }
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || typeof row !== 'object') {
    if (error) {
      logger.error({
        error: sanitizeForLog(error),
        message: 'Agentic merchant context RPC failed',
      });
    }
    return null;
  }
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string') {
    return null;
  }
  const requestControls = readAgenticRequestControls({
    agentic_agent_allowlist: record.agent_allowlist,
    agentic_agent_denylist: record.agent_denylist,
  });
  const context: AgenticMerchantContext = {
    agent_user_agent_allowlist: requestControls.allowlist,
    agent_user_agent_denylist: requestControls.denylist,
    agentic_checkout_enabled: record.agentic_checkout_enabled !== false,
    business_name:
      typeof record.business_name === 'string' ? record.business_name : null,
    custom_domain:
      typeof record.custom_domain === 'string' && record.custom_domain.trim()
        ? record.custom_domain.trim()
        : undefined,
    id: record.id,
    pay_on_delivery_enabled: record.pay_on_delivery_enabled === true,
    paystack_subaccount_code:
      typeof record.paystack_subaccount_code === 'string'
        ? record.paystack_subaccount_code
        : null,
    slug: typeof record.slug === 'string' ? record.slug : merchantSlug,
  };
  if (!includePaymentSplit) {
    return context;
  }
  const paymentSplit = await readAgenticPaymentSplit(
    contextClient,
    normalizedSlug
  );
  if (!paymentSplit.ok) {
    return null;
  }
  return {
    ...context,
    paystack_subaccount_code: paymentSplit.paystackSubaccountCode,
  };
}

async function readAgenticPaymentSplit(
  contextClient: AgenticMerchantContextRpcClient,
  slug: string
): Promise<AgenticPaymentSplitResult> {
  const { data, error } = await contextClient.rpc(
    'resolve_agentic_merchant_payment_split',
    { p_slug: slug }
  );
  if (error) {
    logger.error({
      error: sanitizeForLog(error),
      message: 'Agentic merchant payment split RPC failed',
    });
    return { ok: false };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const code =
    row && typeof row === 'object'
      ? (row as Record<string, unknown>).paystack_subaccount_code
      : null;
  return {
    ok: true,
    paystackSubaccountCode: typeof code === 'string' ? code : null,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/merchant-context.test.ts
```

Expected: all PASS, including the existing `resolveAgenticMerchantContext` tests (removed in Task 8).

- [ ] **Step 5: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/merchant-context.ts apps/web/src/lib/agentic/merchant-context.test.ts
git commit -m "feat(agentic): let completion read the payment split through the scoped resolver"
```

---

### Task 6: Switch the eight non-completion call sites

**Files:**
- Modify: `apps/web/src/app/api/agentic/catalog/search/route.ts`, `catalog/lookup/route.ts`, `catalog/product/route.ts`
- Modify: `apps/web/src/app/api/agentic/checkout_sessions/checkout-session-create-handler.ts`
- Modify: `apps/web/src/app/api/agentic/checkout_sessions/[id]/route-get-handler.ts`, `[id]/checkout-session-update-handler.ts`, `[id]/cancel/route.ts`
- Modify: `apps/web/src/app/api/agentic/orders/[id]/route.ts`
- Test: the 15 test files in Step 3, plus `checkout_sessions/[id]/route-get.test.ts`

- [ ] **Step 1: Switch the three catalog routes**

In each of `catalog/search/route.ts`, `catalog/lookup/route.ts` and `catalog/product/route.ts`:

Replace the import block

```ts
import {
  type AgenticMerchantContext,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
```

with

```ts
import {
  type AgenticMerchantContext,
  resolveAgenticMerchantContextFromRpc,
} from '@/lib/agentic/merchant-context';
```

Delete the line

```ts
import { createAdminClient } from '@/lib/supabase/admin';
```

and replace

```ts
  const merchant = await resolveAgenticMerchantContext(createAdminClient());
```

with

```ts
  const merchant = await resolveAgenticMerchantContextFromRpc();
```

- [ ] **Step 2: Switch create, update, cancel, get and orders**

In `checkout_sessions/checkout-session-create-handler.ts`, `checkout_sessions/[id]/checkout-session-update-handler.ts` and `checkout_sessions/[id]/cancel/route.ts`:

Replace

```ts
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
```

with

```ts
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContextFromRpc,
} from '@/lib/agentic/merchant-context';
```

delete `import { createAdminClient } from '@/lib/supabase/admin';`, and replace

```ts
    const bootstrap = createAdminClient();
    const merchant = await resolveAgenticMerchantContext(bootstrap);
```

with

```ts
    const merchant = await resolveAgenticMerchantContextFromRpc();
```

In `checkout_sessions/[id]/route-get-handler.ts` and `orders/[id]/route.ts`:

Replace

```ts
import { resolveAgenticMerchantContext } from '@/lib/agentic/merchant-context';
```

with

```ts
import { resolveAgenticMerchantContextFromRpc } from '@/lib/agentic/merchant-context';
```

delete `import { createAdminClient } from '@/lib/supabase/admin';`, and replace

```ts
  const bootstrap = createAdminClient();
  const merchant = await resolveAgenticMerchantContext(bootstrap);
```

with

```ts
  const merchant = await resolveAgenticMerchantContextFromRpc();
```

- [ ] **Step 3: Point the route tests at the scoped resolver**

The tests mock `@/lib/agentic/merchant-context`. Rename the mocked function in exactly these 15 files (the completion tests are switched in Task 7):

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client/apps/web/src/app/api/agentic
perl -pi -e 's/\bresolveAgenticMerchantContext\b(?!FromRpc)/resolveAgenticMerchantContextFromRpc/g' \
  catalog/search/route.test.ts \
  catalog/search.ranked-backfill.test.ts \
  catalog/search-junction-category-url.test.ts \
  catalog/product/route.test.ts \
  catalog/lookup/route.test.ts \
  checkout_sessions/route.test.ts \
  checkout_sessions/route-idempotency-replay.test.ts \
  'checkout_sessions/[id]/route.test.ts' \
  'checkout_sessions/[id]/route-storage-rejection.test.ts' \
  'checkout_sessions/[id]/route-payment-state.test.ts' \
  'checkout_sessions/[id]/route-get.test.ts' \
  'checkout_sessions/[id]/route-get-handler.test.ts' \
  'checkout_sessions/[id]/checkout-session-update-handler.test.ts' \
  'checkout_sessions/[id]/cancel/route.test.ts' \
  'orders/[id]/route.test.ts'
```

The regex leaves `mockResolveAgenticMerchantContext` and `resolveAgenticMerchantContextFromRpc` untouched. Keep each file's `vi.mock('@/lib/supabase/admin', …)` and its `expect(createAdminClient).not.toHaveBeenCalled()` assertions; they now act as runtime guards.

- [ ] **Step 4: Flip the one assertion that expected the admin client**

In `checkout_sessions/[id]/route-get.test.ts`, replace

```ts
    expect(createAdminClient).toHaveBeenCalled();
```

with

```ts
    expect(createAdminClient).not.toHaveBeenCalled();
```

- [ ] **Step 5: Run the agentic route suites**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/agentic
```

Expected: everything PASSES except `admin-client-boundary.test.ts`, which now lists only `checkout_sessions/[id]/complete/checkout-session-complete-handler.ts`.

- [ ] **Step 6: Commit (leave the guard test uncommitted)**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
coderabbit review --agent -t uncommitted
git add apps/web/src/app/api/agentic/catalog apps/web/src/app/api/agentic/orders apps/web/src/app/api/agentic/checkout_sessions/route.test.ts apps/web/src/app/api/agentic/checkout_sessions/route-idempotency-replay.test.ts apps/web/src/app/api/agentic/checkout_sessions/checkout-session-create-handler.ts 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route-storage-rejection.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route-payment-state.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route-get.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route-get-handler.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/route-get-handler.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/checkout-session-update-handler.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/checkout-session-update-handler.test.ts' 'apps/web/src/app/api/agentic/checkout_sessions/[id]/cancel'
git status --short
git commit -m "fix(agentic): resolve merchants through the scoped context RPC"
```

Expected from `git status --short` before the commit: only `?? apps/web/src/app/api/agentic/admin-client-boundary.test.ts` remains unstaged.

---

### Task 7: Switch checkout completion

**Files:**
- Modify: `apps/web/src/app/api/agentic/checkout_sessions/[id]/complete/checkout-session-complete-handler.ts`
- Modify: `apps/web/src/app/api/agentic/checkout_sessions/[id]/complete/checkout-session-complete-helpers.ts`
- Test: the five files in `checkout_sessions/[id]/complete/` listed in Step 1

- [ ] **Step 1: Point the completion tests at the scoped resolver**

```bash
cd '/Users/mac/Baci-app/.worktrees/agentic-m0-admin-client/apps/web/src/app/api/agentic/checkout_sessions/[id]/complete'
perl -pi -e 's/\bresolveAgenticMerchantContext\b(?!FromRpc)/resolveAgenticMerchantContextFromRpc/g' \
  route.test.ts \
  route-payment-state.test.ts \
  route-payment-account-resume.test.ts \
  route-db-error.test.ts \
  checkout-session-complete-handler.test.ts
```

- [ ] **Step 2: Add the failing assertion**

In `route.test.ts`, inside the test `'stores DVA payment state without writing agent-only checkout statuses'`, directly after

```ts
    expect(createDedicatedVirtualAccount).toHaveBeenCalledWith(
      expect.any(Object),
      { subaccount: 'ACCT_TESTMOCK1234567' }
    );
```

add

```ts
    expect(mockResolveAgenticMerchantContext).toHaveBeenCalledWith({
      includePaymentSplit: true,
    });
```

That test already proves the exact subaccount reaches DVA creation; the existing test `'rejects checkout completion when the merchant subaccount is missing'` keeps the 424 path covered.

- [ ] **Step 3: Run the completion tests and watch them fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run 'src/app/api/agentic/checkout_sessions/[id]/complete'
```

Expected: FAIL, because the handler still imports `resolveAgenticMerchantContext`, which the renamed mocks no longer provide.

- [ ] **Step 4: Switch the handler**

In `checkout-session-complete-handler.ts`, replace

```ts
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
```

with

```ts
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContextFromRpc,
} from '@/lib/agentic/merchant-context';
```

Delete `import { createAdminClient } from '@/lib/supabase/admin';`. Replace

```ts
    const bootstrap = createAdminClient();
    const merchant = await resolveAgenticMerchantContext(bootstrap);
```

with

```ts
    const merchant = await resolveAgenticMerchantContextFromRpc({
      includePaymentSplit: true,
    });
```

In the `completeAgenticPayOnDelivery({ … })` call, delete the line

```ts
        bootstrap,
```

- [ ] **Step 5: Drop the unused input**

In `checkout-session-complete-helpers.ts`, in the `input` type of `completeAgenticPayOnDelivery`, delete the line

```ts
    bootstrap: SupabaseClient;
```

Keep the `SupabaseClient` import; the file still uses it elsewhere.

- [ ] **Step 6: Run the route suites, including the guard**

```bash
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/agentic
```

Expected: all PASS, including `admin-client-boundary.test.ts`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
coderabbit review --agent -t uncommitted
git add 'apps/web/src/app/api/agentic/checkout_sessions/[id]/complete'
git commit -m "fix(agentic): read the completion payment split without the admin client"
```

---

### Task 8: Delete the admin-path resolver, commit the guard and regenerate the edge inventory

**Files:**
- Modify: `apps/web/src/lib/agentic/merchant-context.ts`
- Modify: `apps/web/src/lib/agentic/merchant-context.test.ts`
- Add: `apps/web/src/app/api/agentic/admin-client-boundary.test.ts` (written in Task 2)
- Regenerate: `docs/superpowers/evidence/storefront-edge/task-1a-inventory.json`
- Modify: `apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts`

- [ ] **Step 1: Confirm nothing calls the old resolver**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
git grep -nP '\bresolveAgenticMerchantContext\b(?!FromRpc)' -- apps/web ':!apps/web/src/lib/agentic/merchant-context.ts' ':!apps/web/src/lib/agentic/merchant-context.test.ts'
```

Expected: no output.

- [ ] **Step 2: Remove it from the module**

In `apps/web/src/lib/agentic/merchant-context.ts`, delete the whole `export async function resolveAgenticMerchantContext(supabase: SupabaseClient)` function, from its signature through its closing `}`. Then delete the now-unused import:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
```

- [ ] **Step 3: Remove its tests**

In `apps/web/src/lib/agentic/merchant-context.test.ts`:

- delete `resolveAgenticMerchantContext,` from the import list at the top;
- delete the helpers `function createMerchantLookupMock(…)` and `function createMerchantWithFeatureSettingsLookupMock(…)`, which run from `function createMerchantLookupMock` up to the line before `function stubBaseEnv() {`;
- delete the whole `describe('resolveAgenticMerchantContext', () => { … });` block, which ends on the line before `describe('isAgenticCheckoutRuntimeConfigured', () => {`.

- [ ] **Step 4: Format and run the tests**

```bash
npm_config_verify_deps_before_run=false pnpm exec biome check --write apps/web/src/lib/agentic/merchant-context.ts apps/web/src/lib/agentic/merchant-context.test.ts apps/web/src/app/api/agentic/admin-client-boundary.test.ts
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/lib/agentic/merchant-context.test.ts src/app/api/agentic
```

Expected: all PASS; Biome reports no errors.

- [ ] **Step 5: Typecheck and lint**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
npm_config_verify_deps_before_run=false pnpm turbo typecheck --filter=@baci/web
npm_config_verify_deps_before_run=false pnpm turbo lint --filter=@baci/web
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
coderabbit review --agent -t uncommitted
git add apps/web/src/lib/agentic/merchant-context.ts apps/web/src/lib/agentic/merchant-context.test.ts apps/web/src/app/api/agentic/admin-client-boundary.test.ts
git commit -m "refactor(agentic): remove the service-role merchant resolver and guard the routes"
```

- [ ] **Step 7: Watch the edge-inventory check fail**

The edge inventory covers the agentic catalog, checkout-session and order routes (`apps/web/tools/cost/storefront-edge-api-source-allowlist.ts`). Its check rebuilds the inventory from the committed source at `HEAD` and compares it with the checked-in file, so the route edits from Tasks 6–8 make it fail until the file is regenerated.

```bash
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run tools/cost/storefront-edge-inventory-snapshot.repository.test.ts
```

Expected: FAIL with `inventory snapshot does not match committed source`.

- [ ] **Step 8: Regenerate the inventory from the committed source**

The generator rejects uncommitted changes to the files it reads, so run it only after Step 6's commit, with a clean `git status`.

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
git status --short
npm_config_verify_deps_before_run=false pnpm --filter @baci/web exec tsx tools/cost/create-storefront-edge-inventory-cli.ts --repo-root "$(git rev-parse --show-toplevel)" --source-sha "$(git rev-parse HEAD)" --pilot-hostname baci-edge-pilot.usebaci.com --posthog-relay-path /baci-relay --output "$(git rev-parse --show-toplevel)/docs/superpowers/evidence/storefront-edge/task-1a-inventory.json"
python3 -c "import json; d=json.load(open('docs/superpowers/evidence/storefront-edge/task-1a-inventory.json')); print(d['inventorySha256'], len(d['rows']))"
git diff --stat docs/superpowers/evidence/storefront-edge/task-1a-inventory.json
```

Expected: `git status --short` prints nothing before the generator runs. The last two commands print the new `inventorySha256` and `585` rows, and the diff touches only digest fields. If the row count is not 585, stop: this plan adds no routes or HTTP methods.

- [ ] **Step 9: Point the snapshot test at the regenerated inventory**

In `apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts`, replace the expected `snapshotSha256` value (`088504efd989605fbd4b9272f5afa7588cde3d2519b2d2ff47a687f503e53237` on the baseline) with the `inventorySha256` printed in Step 8. Leave `rowCount: 585` unchanged.

- [ ] **Step 10: Commit the inventory and rerun the check**

The check validates against committed source, so commit first, then confirm it passes.

```bash
coderabbit review --agent -t uncommitted
git add docs/superpowers/evidence/storefront-edge/task-1a-inventory.json apps/web/tools/cost/storefront-edge-inventory-snapshot.repository.test.ts
git commit -m "chore(cost): regenerate edge inventory after agentic route changes"
cd apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run tools/cost/storefront-edge-inventory-snapshot.repository.test.ts
```

Expected: PASS. If any later task edits a file under `apps/web/src/app/api/agentic`, repeat Steps 7–10 after committing it.

---

### Task 9: Refresh the capability register

This plan edits `catalog/search/route.ts` and `orders/[id]/route.ts`, which the register's `agent-protocols` row binds by content, so the binding gate fails until the row is re-reviewed.

**Files:**
- Modify: `docs/product/baci-capabilities.json`
- Modify: `docs/product/agent-access-map.md`

- [ ] **Step 1: Run the gate and watch it fail**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
BASE_SHA=$(git merge-base origin/main HEAD) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py
```

Expected: FAIL in the binding suite, naming the changed content of the files cited by `agent-protocols`.

- [ ] **Step 2: Re-review the claim**

Read the `agent-protocols` row in `docs/product/baci-capabilities.json`. This plan changes only how the merchant is resolved: the claim (ACP and UCP discovery, catalog, carts, checkout sessions and order reading for authorized agents) and its limitations stay true, so leave `claim`, `limitations` and `status` unchanged.

- [ ] **Step 3: Record the reviewed revision**

```bash
git rev-parse HEAD
date -u +%Y-%m-%dT%H:%M:%S+00:00
```

In `docs/product/baci-capabilities.json`, set the top-level `"source_revision"` to the commit printed by the first command and `"reviewed_at"` to the timestamp printed by the second.

- [ ] **Step 4: Regenerate the digests**

```bash
python3 vps-workers/baci-editorial-context/register_digests.py --write
```

Expected: `evidence_digest` and `claims_digest` are rewritten.

- [ ] **Step 5: Update the access map header**

In `docs/product/agent-access-map.md`, replace the first paragraph, which begins `Reviewed 30 October 2026 against source revision`, with the following, using today's date and the commit from Step 3:

```markdown
Reviewed <day> <Month> <year> against source revision
`<commit from Step 3>`. Agentic routes now resolve the merchant through the
scoped context RPC instead of a service-role client; the cited claims are
unchanged. This is a navigation map, not authorization or proof of current
deployment. Check the current implementation, live tool discovery and merchant
entitlement before calling or claiming a tool.
```

Write the date exactly as the existing format expects, for example `Reviewed 31 October 2026`.

- [ ] **Step 6: Run the gate again**

```bash
BASE_SHA=$(git merge-base origin/main HEAD) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
coderabbit review --agent -t uncommitted
git add docs/product/baci-capabilities.json docs/product/agent-access-map.md
git commit -m "docs(capabilities): re-review agent protocols after scoped merchant resolution"
```

---

### Task 10: Final verification and pull request

- [ ] **Step 1: Run every affected suite**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client/apps/web
npm_config_verify_deps_before_run=false pnpm exec vitest run src/app/api/agentic src/lib/agentic tools/db/supabase-history-replay-cart-pending-sources.test.ts tools/db/verify-supabase-history-replay-manifest.test.ts tools/db/supabase-history-replay-manifest.test.ts tools/db/verify-current-migration-registry.test.ts tools/cost/storefront-edge-inventory-snapshot.repository.test.ts tools/events/verify-analytics-delivery-authority.repository.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Rerun the SQL tests on the final tree**

Repeat Task 3 Steps 2 and 4 (start the throwaway database, copy `supabase`, run both SQL files), then Task 3 Step 5. Expected: both `exit=0`.

- [ ] **Step 3: Rerun typecheck, lint and the capability gate**

```bash
cd /Users/mac/Baci-app/.worktrees/agentic-m0-admin-client
npm_config_verify_deps_before_run=false pnpm turbo typecheck --filter=@baci/web
npm_config_verify_deps_before_run=false pnpm turbo lint --filter=@baci/web
BASE_SHA=$(git merge-base origin/main HEAD) BACI_REGISTER_REQUIRE_FRESH=1 python3 vps-workers/baci-editorial-context/capability_gate.py
```

Expected: all succeed.

- [ ] **Step 4: Push and open the pull request, with the owner's go-ahead**

```bash
git push -u origin fix/agentic-remove-admin-client
gh pr create --title "fix(agentic): remove the service-role client from agentic routes" --body-file /tmp/agentic-m0-1-pr-body.md
```

Write `/tmp/agentic-m0-1-pr-body.md` first. It must cover: the nine call sites; the separate payment-split function and why the shared projection keeps withholding the subaccount; the migration and its registry entries; the capability-register refresh; and the test evidence from Steps 1–3. If the pre-push hook hangs, follow the repository's documented API-push fallback; never use `--no-verify`.

- [ ] **Step 5: Follow the pull-request gates**

Wait for green CI, the Codex review verdict and the required AI-review gate on the latest commit. A rebase or other history change invalidates earlier results. Do not merge or deploy without the owner's explicit approval.

- [ ] **Step 6: After an authorized merge and deploy, confirm the function is live**

With the owner's approval, run this read-only query against production:

```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('agentic_merchant_context', p.oid, 'EXECUTE') AS context_role_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'resolve_agentic_merchant_payment_split';
```

Expected: one row, `anon_can_execute = false`, `context_role_can_execute = true`. A merged migration is not proof that it was applied.

---

## Self-review

- **Roadmap coverage:**
  - All nine call sites are switched: Tasks 6 and 7.
  - The payment split keeps working, and completion still fails with 424 when no subaccount is configured: Tasks 3, 5 and 7.
  - The unused `bootstrap` input is removed: Task 7.
  - A regression guard is in place: Tasks 2 and 8.
  - No existing broad RPC is granted to clients; the new function is executable only by `agentic_merchant_context`, as Task 3's SQL test proves.
  - Multi-merchant binding is deferred to Task 5, as stated in Scope.
- **Ordering:**
  - Task 6 renames mocks only for handlers it switches. Completion tests are renamed in Task 7, together with the completion handler, so every commit is green.
  - The guard test stays uncommitted until it passes in Task 8.
  - The edge inventory is regenerated once, in Task 8, after every route edit is committed; its check reads committed source, so it cannot be refreshed earlier.
- **Names:** `resolveAgenticMerchantContextFromRpc`, `includePaymentSplit`, `resolve_agentic_merchant_payment_split`, `readAgenticPaymentSplit` and `AgenticPaymentSplitResult` are spelled the same in every task.
