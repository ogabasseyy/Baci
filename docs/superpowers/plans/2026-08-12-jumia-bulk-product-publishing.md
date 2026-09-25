# Jumia Bulk Product Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants filter their Baci catalog, explicitly select multiple products, classify them for one connected Jumia shop, and submit safe bounded product-feed batches.

**Architecture:** First repair mapping identity so each product/variant is unique per integration, then add a merchant-scoped candidate endpoint, selection/classification workflow, bounded feed submission, and asynchronous feed reconciliation. Publishing is explicit; automatic background price or inventory propagation is not claimed.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase with RLS, Jumia feed API, Vitest, React Testing Library.

## Global Constraints

- Merchant chooses exactly one connected shop per publishing run.
- Category and condition are independent filters; no products are selected initially.
- Select all applies only to visible filtered results.
- Never claim automatic sync without a durable worker; preserve explicit stock, price, and status pushes.
- Every request is authenticated, CSRF-protected where mutating, Zod-validated before database access, merchant-scoped, and limited.
- Every new runtime file has a colocated behavioral test and remains below 300 lines.
- Feed submission creates pending mappings; only feed-detail reconciliation marks individual SKUs synced or failed.

---

### Task 1: Repair Product Mapping Identity Per Integration

**Files:**
- Create: `supabase/migrations/20260812XXXXXX_fix_jumia_mapping_identity.sql`
- Create: `supabase/migrations/tests/jumia_mapping_identity/01_mapping_identity.sql`
- Modify: `apps/web/src/types/supabase.ts`
- Modify: `apps/web/src/app/api/marketplace/jumia/products/export/route.ts`
- Modify: `apps/web/src/app/api/marketplace/jumia/products/export/route.test.ts`

**Interfaces:**
- Adds `integration_id` and enforces one mapping per product, nullable variant, and integration with NULLS NOT DISTINCT semantics.
- Existing export upserts against the real constraint and never overwrites another shop's mapping.

- [ ] **Step 1: Write failing SQL and route tests** reproducing the current `onConflict: 'merchant_id,jumia_sku'` mismatch, duplicate null-variant rows, and one product exported to two integrations.
- [ ] **Step 2: Run focused tests** and confirm the mismatch/duplicate cases fail.
- [ ] **Step 3: Add an append-only migration** that backfills integration ID from merchant/shop identity, quarantines ambiguous rows instead of guessing, adds the foreign key, and adds a NULLS NOT DISTINCT unique index.
- [ ] **Step 4: Update export and generated types** to use the new conflict identity.
- [ ] **Step 5: Run SQL tests, export tests, and typecheck**.
- [ ] **Step 6: Commit** with `fix: scope Jumia product mappings to integrations`.

### Task 2: Define Candidate and Publishing Contracts

**Files:**
- Create: `apps/web/src/schemas/jumia/product-publishing.ts`
- Create: `apps/web/src/schemas/jumia/product-publishing.test.ts`

**Interfaces:**
- Candidate query fields: `integrationId`, `categoryId?`, `condition?`, `brandId?`, `status?`, `inStock?`, `search?`, `cursor?`, `limit` capped at 50.
- Publish item: `{ productId; jumiaCategory: { code: number }; jumiaBrand: { code: number; name: string } }`.
- Publish request: `{ integrationId; items }` capped at 50 unique product IDs.

- [ ] **Step 1: Write failing schema tests** for every filter, canonical conditions, invalid UUIDs, bounds, duplicate products, empty items, and oversized batches.
- [ ] **Step 2: Run the schema suite** and confirm failure.
- [ ] **Step 3: Implement one exported schema contract per focused file if needed** to comply with repository modularity.
- [ ] **Step 4: Run the schema suite** and confirm all boundaries pass.
- [ ] **Step 5: Commit** with `feat: define Jumia bulk publishing contracts`.

### Task 3: List Merchant-Scoped Publishing Candidates

**Files:**
- Create: `apps/web/src/app/api/marketplace/jumia/products/candidates/route.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/products/candidates/route.test.ts`
- Create: `apps/web/src/lib/jumia/product-candidates.ts`
- Create: `apps/web/src/lib/jumia/product-candidates.test.ts`

**Interfaces:**
- Returns safe product summaries plus `mappingStatus: 'unmapped' | 'pending' | 'synced' | 'failed'` for the selected shop and a next cursor.

- [ ] **Step 1: Write route tests** for 401, validation before DB access, integration ownership, feature access, category-only, condition-only, combined filters, brand/status/stock/search filters, cursor pagination, and empty results.
- [ ] **Step 2: Write query-helper tests** proving every query includes merchant ID, explicit columns, deterministic ordering, a maximum of 50 rows, and the selected shop mapping join.
- [ ] **Step 3: Run focused tests** and confirm missing implementation failures.
- [ ] **Step 4: Implement the route and query helper** using Baci category IDs, explicit descendant-category expansion, and canonical product/variant conditions; return no credentials.
- [ ] **Step 5: Run focused tests and `pnpm --filter @baci/web typecheck`**.
- [ ] **Step 6: Commit** with `feat: list filtered Jumia publishing candidates`.

### Task 4: Build Feed Payloads from Server-Owned Products

**Files:**
- Create: `apps/web/src/lib/jumia/product-publish-payload.ts`
- Create: `apps/web/src/lib/jumia/product-publish-payload.test.ts`

**Interfaces:**
- Produces `buildJumiaPublishPayload(product, classification)` with sanitized name/description, images, and one or more variant payloads.
- Returns a readiness result: `{ status: 'ready'; payload } | { status: 'blocked'; reasons: string[] }`.

- [ ] **Step 1: Write failing tests** for simple products, conditioned variants, missing SKU, invalid price, missing images, zero stock, sanitized text, and per-product Jumia category/brand.
- [ ] **Step 2: Run the focused suite** and confirm failure.
- [ ] **Step 3: Implement payload construction** from freshly queried merchant-owned records; never trust browser-provided product content, price, stock, SKU, or images.
- [ ] **Step 4: Run the focused suite** and confirm deterministic readiness reasons.
- [ ] **Step 5: Commit** with `feat: build safe Jumia product feed payloads`.

### Task 5: Submit Bounded Product Batches as Pending

**Files:**
- Create: `apps/web/src/app/api/marketplace/jumia/products/publish/route.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/products/publish/route.test.ts`
- Create: `apps/web/src/lib/jumia/publish-products.ts`
- Create: `apps/web/src/lib/jumia/publish-products.test.ts`

**Interfaces:**
- Response contains `ready`, `submittedPending`, `blocked`, `alreadyMapped`, and `feedIds`.
- A feed ID means accepted for asynchronous processing, not product success.

- [ ] **Step 1: Write route tests** for auth, CSRF, validation, shop ownership, server-side product ownership, already-mapped rows, missing classification, and safe responses.
- [ ] **Step 2: Write orchestrator tests** for one/multiple bounded batches, provider rejection before a feed ID, pending persistence after a feed ID, transactional mapping failure, and duplicate-submit idempotency.
- [ ] **Step 3: Run focused tests** and confirm failure.
- [ ] **Step 4: Implement fresh product loading, readiness evaluation, feed submission, and pending mapping upserts** with integration ID, seller SKU, feed ID, and pending status.
- [ ] **Step 5: Run focused tests and ensure logs contain product IDs/feed IDs only, never credentials or provider bodies**.
- [ ] **Step 6: Commit** with `feat: publish selected products to Jumia`.

### Task 6: Reconcile Feed Items to Product Outcomes

**Files:**
- Create: `apps/web/src/lib/jumia/product-feed-reconciliation.ts`
- Create: `apps/web/src/lib/jumia/product-feed-reconciliation.test.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/products/feeds/[feedId]/route.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/products/feeds/[feedId]/route.test.ts`

**Interfaces:**
- Polls an owned integration feed, matches items by seller SKU plus integration, and transitions pending mappings to `synced` or `error` with sanitized summaries.
- Terminal reconciliation is idempotent; non-terminal feeds remain pending and return a retry interval.

- [ ] **Step 1: Write failing tests** for processing, terminal success, mixed item failure, unknown SKU, duplicate polling, cross-integration denial, sanitized errors, and timeout.
- [ ] **Step 2: Run focused tests** and confirm missing implementation failures.
- [ ] **Step 3: Implement the reconciler and authenticated status route** using existing feed-detail parsing and explicit mapping columns.
- [ ] **Step 4: Run focused tests** and verify provider/customer identity from feed details never reaches logs or responses.
- [ ] **Step 5: Commit** with `feat: reconcile Jumia product feed outcomes`.

### Task 7: Build Filtered Multi-Product Selection UI

**Files:**
- Create: `apps/web/src/app/dashboard/channels/jumia-product-publisher.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-publisher.test.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-filters.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-filters.test.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-selection.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-selection.test.tsx`
- Modify: `apps/web/src/app/dashboard/channels/client-page.tsx`
- Modify: `apps/web/src/app/dashboard/channels/client-page.test.tsx`

**Interfaces:**
- Publisher stages: shop, filter/select, classify, review, results.
- Selection is keyed by product ID and cleared when the destination shop changes.

- [ ] **Step 1: Write UI tests** for choosing one shop, Gaming category filtering, Brand new condition filtering, combined filters, no initial selection, visible-only select all, pagination, mapped-product disablement, and shop-change clearing.
- [ ] **Step 2: Run focused tests** and confirm failure.
- [ ] **Step 3: Implement the extracted filter and selection components** with accessible labels and server-driven pagination.
- [ ] **Step 4: Add the Sales channels "Sync products" entry point** while preserving single-product export.
- [ ] **Step 5: Run focused tests and accessibility checks**.
- [ ] **Step 6: Commit** with `feat: select filtered products for Jumia`.

### Task 8: Add Classification, Review, Polling, and Retry UI

**Files:**
- Create: `apps/web/src/app/dashboard/channels/jumia-product-classification.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-product-classification.test.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-publish-results.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-publish-results.test.tsx`
- Modify: `apps/web/src/components/products/jumia-sync-settings.tsx`
- Modify: `apps/web/src/components/products/jumia-sync-settings.test.tsx`

**Interfaces:**
- Bulk category/brand values seed all selected products; per-product overrides win.
- Only ready products are submitted; results poll pending feeds and retry sends failed product IDs only after terminal reconciliation.

- [ ] **Step 1: Write tests** for bulk classification, per-product override, blocked rows, readiness counts, pending polling, mixed terminal results, and failed-only retry.
- [ ] **Step 2: Add copy regression tests** proving settings do not claim automatic price/inventory syncing.
- [ ] **Step 3: Run focused tests** and confirm failure.
- [ ] **Step 4: Implement classification/review/results components and truthful explicit-sync copy**.
- [ ] **Step 5: Run all Jumia suites**, then `pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test`.
- [ ] **Step 6: Run `coderabbit review --agent -t uncommitted`**, address critical/high findings, and rerun affected gates.
- [ ] **Step 7: Commit** with `feat: review and publish Jumia product batches`.
