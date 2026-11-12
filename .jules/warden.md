## 2024-05-24 - Missing Query Scoping in Product Reviews

**Learning:** Checking ownership of a resource in application code using `merchantContext.merchantId !== review.merchant_id` is insufficient for robust data integrity. Query builder methods like `.update()` and `.delete()` must also be explicitly scoped with `.eq('merchant_id', ...)` to prevent race conditions or app-logic bypasses.
**Action:** Always append `.eq('merchant_id', merchantId)` to all database mutations (`.update()`, `.delete()`, `.upsert()`) to ensure defense-in-depth, even if application-level checks are present.

## 2025-05-24 - Prevent `select('*')` Overfetching in Customer Searches

**Learning:** Using `select('*')` when checking for existing customers overfetches all columns, increasing payload size and query execution time unnecessarily.
**Action:** Always specify exact columns needed (like `id, first_name, last_name, email, phone, address`) instead of `*` for database reads to improve performance and prevent unintended data exposure.

## 2025-02-27 - Unhandled Errors in maybeSingle / single Queries

**Learning:** Destructuring `{ data }` from `supabase.from().single()` or `maybeSingle()` without checking for the `error` object causes silent failures. If `.single()` expects 0 rows, it incorrectly throws a PGRST116 error that could be swallowed. On the flip side, real database errors on `.maybeSingle()` are ignored if `error` is unchecked, allowing dependent logic to proceed with `data = null` improperly, leading to data integrity issues.
**Action:** Always extract and handle `error` explicitly when fetching data. Use `.maybeSingle()` when 0 rows is valid, and handle true database errors distinctly from the 0-rows case.

## 2026-05-24 - Missing Query Scoping in Transaction Updates

**Learning:** When performing updates on resources like transactions, even if the user has been authenticated and the transaction has been fetched using a gateway reference, the subsequent `.update()` call using the record's ID must still explicitly include `.eq('merchant_id', merchantId)`. Relying solely on the ID or prior fetched data creates a vulnerability if an attacker can manipulate IDs or references.
**Action:** Always append `.eq('merchant_id', merchantId)` to all database mutations (`.update()`, `.delete()`, `.upsert()`) to ensure multi-tenant isolation, regardless of whether the target record's ID was obtained securely.

## 2026-06-02 - Missing Tenant Isolation in Order Updates

**Learning:** Even when modifying data derived from a known entity (like an `order_id`), Supabase `.update()` calls can act as IDOR (Insecure Direct Object Reference) vectors if not explicitly scoped by `merchant_id`. In `record-payment`, the order status was being updated purely by `id`, which could allow a malicious user to modify another tenant's order status if they guess the ID.
**Action:** ALWAYS chain `.eq('merchant_id', merchantId)` onto database mutations (`.update()`, `.delete()`), even when selecting by the record's primary key (`.eq('id', id)`). This ensures defense-in-depth against cross-tenant data modification.

## 2026-06-05 - Missing merchant_id scope in negotiation updates

**Learning:** Updates to the `negotiation_requests` table lacked `.eq('merchant_id', merchant.id)` scoping. Although it checked `id`, omitting `merchant_id` could allow a cross-tenant data leak if an attacker somehow guesses another merchant's negotiation request ID. RLS is a defense line, but application code should always defensively scope updates to the authenticated context.
**Action:** Always append `.eq('merchant_id', merchant.id)` when executing mutations (`.update()`, `.delete()`, `.insert()`) on tenant-specific tables to enforce defense-in-depth tenant isolation.

## 2026-06-11 - Silent Failure on Supabase Mutations

**Learning:** Performing a Supabase mutation (like `.delete()`) and logging the error without returning a failure response can lead to inconsistent state and silent failures, where the application incorrectly assumes success and proceeds with dependent operations.
**Action:** Always check the `error` object returned from Supabase mutations and explicitly return an error response (e.g., `500`) to halt execution and signal the failure to the client.
2026-06-16 — Supabase .single() Silent Failure
Learning: When using `.single()` in Supabase on a query that might return 0 rows (like looking up an existing push token for a new device), Supabase returns `{ data: null, error: { code: 'PGRST116' } }`. If the code ignores the `error` object and only checks `if (data)`, it proceeds correctly for 0 rows, BUT it also silently proceeds if there's a genuine database failure (like a connection timeout), hiding the real error.
Action: Use `.maybeSingle()` when 0 or 1 rows are expected, and explicitly check `if (error)` to catch genuine database failures.
Source: Supabase v2 Docs - Select Data
2026-06-19 — [Validation of API Route Bodies]
Learning: Blindly type-casting the request body in an API route bypasses runtime safety and creates a data-integrity risk.
Action: Always use Zod `safeParse` to validate the incoming API payload against a defined schema and return a 400 error if it fails, instead of type casting.
Source: Zod 4 documentation, Warden persona rules
2026-06-23 — [Payout Request Scope Fix]
Learning: Unscoped Supabase `.update()` calls can allow cross-tenant data leaks if not explicitly constrained with `.eq('merchant_id', merchantId)`.
Action: Always append `.eq('merchant_id', merchantId)` to all Supabase `.update()` or `.delete()` mutations for defense-in-depth, even when the row is queried by a unique ID.
Source: Baci Monorepo Context Guidelines

## 2026-06-28 — Tenant filters on update mutations

**Learning:** Supabase/PostgREST update filters compose, so adding `.eq('merchant_id', merchantId)` to an `.update(...).eq('id', ...).eq('updated_at', ...)` chain is a low-cost defense-in-depth guard against guessed row ids.
**Action:** User-facing tenant writes should include the tenant predicate even when the row id was fetched through a tenant-scoped read.
**Source:** Supabase JavaScript update/filter docs, verified 2026-06-28.
2025-03-08 — Defense-in-depth scoping on read-modify-write
Learning: Even when reading a row securely first, the subsequent write mutation must also explicitly re-scope by tenant (`merchant_id`) and owner (`user_id`) to prevent race conditions or forged updates, acting as defense-in-depth even with RLS enabled.
Action: Always add `.eq('merchant_id', ...)` and `.eq('user_id', ...)` to mutation queries (insert/update/delete) in addition to `.eq('id', ...)`.
Source: codebase convention / AGENTS.md
