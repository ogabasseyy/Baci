# Jumia Self Authorization Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant validate their own Jumia client ID and refresh token, discover their shops, and connect an explicit selection of shops.

**Architecture:** Store one encrypted Self Authorization grant and reference it from every selected shop integration, preventing refresh-token rotation from diverging across shops. Add focused exchange/discovery services and two authenticated POST operations; connect repeats validation before a transactional authorization-plus-shop persistence RPC.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase with RLS, Vitest, React Testing Library.

## Global Constraints

- Authentication and CSRF checks precede protected work; Zod validation precedes database access after authentication.
- Never log, return, or place in URLs any client ID, authorization code, access token, refresh token, ciphertext, or provider response body.
- Use the authenticated scoped Supabase client; do not introduce a service-role edge.
- Store Self Authorization credentials only as AES-256-GCM ciphertext under a dedicated server-only key; never copy one rotating refresh token into multiple shop rows.
- RLS may expose only opaque ciphertext to its owning merchant context; no database function returns plaintext, and only server code holding the encryption key can decrypt it.
- Preserve automatic OAuth and its platform client ID behavior.
- Every new runtime file has a colocated behavioral test and remains below 300 lines.

---

### Task 1: Add Shared Authorization Storage

**Files:**
- Create: `supabase/migrations/20260812XXXXXX_add_jumia_authorizations.sql`
- Create: `supabase/migrations/tests/jumia_authorizations/01_shared_authorization.sql`
- Modify: `apps/web/src/types/supabase.ts`

**Interfaces:**
- Produces `jumia_authorizations` with merchant ID, ciphertext, expiry, and rotation version.
- Produces integration columns `connection_method` and nullable `jumia_authorization_id`.
- Produces an authenticated transactional RPC that derives authority from `auth.uid()`, persists ciphertext and selected shops, and returns safe IDs only.

- [ ] **Step 1: Write failing SQL tests** for owner and authorized-staff success, cross-merchant denial, ciphertext-only storage, multiple shops sharing one authorization, uniqueness, and rollback.
- [ ] **Step 2: Run the migration harness** and confirm the new objects are absent.
- [ ] **Step 3: Add the append-only migration** with RLS, explicit privileges, constraints, foreign keys, and the narrowly scoped authenticated RPC; do not expose plaintext functions.
- [ ] **Step 4: Regenerate Supabase types** using the repository command.
- [ ] **Step 5: Run SQL tests and generated-type integrity checks**.
- [ ] **Step 6: Commit** exact task files with `feat: store shared Jumia authorizations`.

### Task 2: Validate Self-Authorization Credentials and Discover Shops

**Files:**
- Create: `apps/web/src/schemas/jumia/self-authorization.ts`
- Create: `apps/web/src/schemas/jumia/self-authorization.test.ts`
- Create: `apps/web/src/lib/jumia/self-authorization.ts`
- Create: `apps/web/src/lib/jumia/self-authorization.test.ts`
- Create: `apps/web/src/lib/jumia/authorization-crypto.ts`
- Create: `apps/web/src/lib/jumia/authorization-crypto.test.ts`
- Modify: `apps/web/src/env.ts`

**Interfaces:**
- Produces `jumiaSelfAuthorizationCredentialsSchema` for `{ clientId: string; refreshToken: string }`.
- Produces `validateJumiaSelfAuthorization(credentials): Promise<{ accessToken: string; accessTokenExpiresAt: string; rotatedRefreshToken?: string; shops: SafeJumiaShop[] }>`.
- Produces authenticated encrypt/decrypt helpers using `JUMIA_AUTHORIZATION_ENCRYPTION_KEY`.

- [ ] **Step 1: Write schema tests** for trimmed non-empty credentials, missing values, wrong types, and oversized values.
- [ ] **Step 2: Write service and crypto tests** proving client-ID forwarding, token validation, shop discovery, sanitized errors, fresh nonces, and wrong-key/tampered/missing-key failure.
- [ ] **Step 3: Run both focused suites** and confirm they fail because the exports do not exist.
- [ ] **Step 4: Implement the schemas and service** using existing Jumia endpoint/client helpers, returning raw credentials only to server callers and safe shop metadata separately.
- [ ] **Step 5: Run the focused suites** and scan captured logs/serialized results to confirm no credential values appear.
- [ ] **Step 6: Commit** with `feat: validate Jumia self authorization credentials`.

### Task 3: Add Discover and Connect Operations

**Files:**
- Create: `apps/web/src/app/api/marketplace/jumia/connect/self-authorization-discovery.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/connect/self-authorization-discovery.test.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/connect/self-authorization-persistence.ts`
- Create: `apps/web/src/app/api/marketplace/jumia/connect/self-authorization-persistence.test.ts`
- Modify: `apps/web/src/app/api/marketplace/jumia/connect/route.ts`
- Modify: `apps/web/src/app/api/marketplace/jumia/connect/route.test.ts`

**Interfaces:**
- POST discovery input: `{ connectionType: 'self_authorization_discover'; clientId; refreshToken }`.
- POST connect input: `{ connectionType: 'self_authorization_connect'; clientId; refreshToken; shopIds: string[] }`.
- Discovery output: `{ shops: Array<{ id; name; countryCode; alreadyConnected }> }` with `Cache-Control: private, no-store`.
- Connect output: `{ connected: SafeJumiaShop[]; alreadyConnected: SafeJumiaShop[] }`.

- [ ] **Step 1: Write discovery route tests** for 401, CSRF failure, malformed input before DB access, provider rejection, no shops, safe success metadata, no-store, and zero integration writes.
- [ ] **Step 2: Write persistence tests** for revalidation, encryption before RPC invocation, undiscovered IDs, empty/duplicate selections, already-connected shops, one authorization shared by multiple shops, and all-or-nothing persistence.
- [ ] **Step 3: Run focused route/helper tests** and verify the new discriminants fail.
- [ ] **Step 4: Implement focused handlers** and make the oversized route delegate to them, leaving the route shorter than before.
- [ ] **Step 5: Run focused tests** and `pnpm --filter @baci/web typecheck`.
- [ ] **Step 6: Commit** with `feat: connect selected Jumia self authorization shops`.

### Task 4: Build the Two-Step Merchant Dialog

**Files:**
- Create: `apps/web/src/app/dashboard/channels/jumia-self-authorization-form.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-self-authorization-form.test.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-shop-selection.tsx`
- Create: `apps/web/src/app/dashboard/channels/jumia-shop-selection.test.tsx`
- Modify: `apps/web/src/app/dashboard/channels/connect-jumia-dialog.tsx`
- Modify: `apps/web/src/app/dashboard/channels/connect-jumia-dialog.test.tsx`

**Interfaces:**
- Form owns client ID and refresh token in component state and clears them on close/success.
- Shop selector receives safe discovered shops and emits a non-empty selected-ID array; no shop begins selected.

- [ ] **Step 1: Write failing UI tests** for the method choice, exactly two credential fields, loading/error states, zero default selections, disabled already-connected shops, multi-selection, and credential-state clearing.
- [ ] **Step 2: Run focused component tests** and confirm failure.
- [ ] **Step 3: Implement the extracted form and selector** with accessible labels, password treatment for the refresh token, and Vendor Center instructions.
- [ ] **Step 4: Wire discovery then connect** without writing credentials to URL state, storage, analytics, or console output.
- [ ] **Step 5: Run focused tests and accessibility assertions**.
- [ ] **Step 6: Commit** with `feat: add Jumia self authorization shop picker`.

### Task 5: Refresh the Shared Authorization Safely

**Files:**
- Modify: `apps/web/src/lib/jumia/client.ts`
- Modify: `apps/web/src/lib/jumia/client.test.ts`
- Create: `apps/web/src/lib/jumia/shared-authorization-refresh.ts`
- Create: `apps/web/src/lib/jumia/shared-authorization-refresh.test.ts`
- Modify: `apps/web/src/app/dashboard/channels/use-jumia-integrations.test.ts`

**Interfaces:**
- `JumiaClient.forIntegration` decrypts the referenced shared grant; compare-and-swap rotation prevents concurrent shops from overwriting a newly rotated token; OAuth remains unchanged.

- [ ] **Step 1: Add regression tests** for two shops sharing a grant, concurrent refresh attempts, rotation, stale-version reload, missing/corrupt state, and unchanged OAuth refresh.
- [ ] **Step 2: Run the focused tests** and confirm the self-authorization refresh cases fail.
- [ ] **Step 3: Implement minimal client loading/refresh changes**, extracting touched logic if the 300-line file would grow.
- [ ] **Step 4: Run Jumia-focused tests**, then `pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test`.
- [ ] **Step 5: Run `coderabbit review --agent -t uncommitted`**, fix critical/high findings, and rerun affected tests.
- [ ] **Step 6: Commit** with `feat: refresh merchant-specific Jumia connections`.
