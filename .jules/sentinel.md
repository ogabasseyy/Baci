# Security Changelog

## 2026-03-08 - Fix Timing Attack in Blog Upload Authentication

**Vulnerability:** The `devOverrideSecret` was being compared to `expectedSecret` using strict equality (`===`). This exposed the endpoint to a timing attack where an attacker could theoretically guess the secret character by character.

**Learning:** Even internal or development-only endpoints should use secure comparison functions for secrets to establish defense-in-depth and prevent accidental leakage if the code is later reused in production contexts.

**Prevention:** Always use `constantTimeEqual` or `crypto.timingSafeEqual` when comparing passwords, tokens, API keys, or webhooks signatures. Ensure variables are checked for truthiness before passing to avoid runtime type errors.

## 2026-03-08 - Fix Incorrect Supabase Client in MyCover Webhook
**Vulnerability:** The MyCover webhook handler used `createAdminClient` instead of `createServiceClient`. `createAdminClient` uses the `anon` key, which respects RLS policies, making it unsuitable for webhook handlers that run without a user context and need to bypass RLS.
**Learning:** Webhook handlers must always use the service role client (`createServiceClient`) to bypass RLS since they operate outside of an authenticated user session.
**Prevention:** Ensure all new webhook handlers import and use `createServiceClient` from `@/lib/supabase/service`.

## 2026-04-06 - Timing Attack Vulnerability in Webhook Signature Verification
**Vulnerability:** A strict equality operator (`===`) was used to compare webhook signature checksums in the Juicyway integration (`apps/web/src/lib/juicyway/webhook.ts`), allowing potential timing attacks to forge signatures.
**Learning:** Even when the developer correctly adds a comment stating `// Constant-time comparison to prevent timing attacks`, the actual implementation might simply use strict string equality (`===`).
**Prevention:** Always use the `constantTimeEqual` utility from `@/lib/constant-time-equal` for comparing authentication tokens, hashes, and webhook signatures. Ensure explicitly checking that both inputs are defined before calling the utility.

## 2026-04-21 - Fix Missing Input Validation in API Routes
**Vulnerability:** The cart validation endpoint `POST /api/cart/validate` was trusting client input via `body as { ... }` instead of properly validating the shape and types of the request body. While there was a regex check for UUIDs later in the code, the lack of top-level schema validation exposes the system to potential unexpected runtime errors or injection of malformed data structures.
**Learning:** Type assertions (using `as Type`) only instruct TypeScript to assume a type during compilation; they provide zero runtime protection.
**Prevention:** Always use Zod schemas (e.g., `cartValidateSchema.safeParse(body)`) to validate incoming request bodies on API routes before processing them. Return a `400 Bad Request` explicitly if validation fails.
## 2026-05-13 - Missing Authentication on Claims Sync Endpoint
**Vulnerability:** The API endpoint `apps/web/src/app/api/insurance/claims/sync/route.ts` was unauthenticated. While it checked for a CSRF token, it lacked actual authorization to execute its background/cron logic.
**Learning:** The endpoint contained a comment (`// In a real scenario, verify admin auth or cron secret`) but didn't implement the check, leaving it exposed to anyone who could pass the CSRF check (or send a request where CSRF wasn't enforced properly).
**Prevention:** Always implement authentication/authorization checks for administrative and cron endpoints using standard helpers like `getCronSecret()` and `constantTimeEqual()`, and never rely on CSRF protection alone or leave security implementations as TODO comments.

## 2025-05-20 - Standardize Cron Authentication Headers
**Vulnerability:** Use of custom `x-cron-secret` HTTP header for secret passing in cron endpoints (`publish-scheduled-posts`, `wallet-payouts`, `insurance/claims/sync`).
**Learning:** Some background endpoints were using a custom header which is a bad security practice because proxies and other intermediators might strip them or log them improperly. Furthermore, using a standard `Authorization: Bearer <secret>` header ensures consistency across the codebase and aligns with the expected format from calling clients.
**Prevention:** Always prefer using the standard `Authorization` HTTP header with a bearer token for authentication. In the Baci monorepo, cron endpoints should use the standard `Authorization` header fallback, extracting it and passing it to `constantTimeEqual()` against `getCronSecret()`.

## 2026-05-23 - Timing Attack Vulnerability in Custom XOR String Comparison Loop
**Vulnerability:** A manual bitwise XOR loop was used to compare webhook signature checksums in the MyCover webhook handler (`apps/web/src/app/api/webhooks/mycover/route.ts`). While intended to be constant-time, modern JS engine optimizations can make such manual loops susceptible to timing attacks, potentially allowing forged signatures.
**Learning:** Manual implementations of cryptographic operations (like bitwise XOR loops for signature verification) are unsafe in JavaScript due to engine-level JIT optimizations.
**Prevention:** Never implement custom logic for constant-time comparisons. Always use the built-in `constantTimeEqual` utility from `@/lib/constant-time-equal` (which relies on Node's native `crypto.timingSafeEqual`) for comparing authentication tokens, hashes, and webhook signatures securely.

## 2026-05-23 - Fix Timing Attack Vulnerability in Crawler Log API
**Vulnerability:** The crawler log endpoint (`apps/web/src/app/api/analytics/crawler-log/route.ts`) was using strict string equality (`===`) to compare the incoming `Authorization` header against the expected internal API secret, exposing the endpoint to potential timing attacks.
**Learning:** Internal service-to-service endpoints and webhook routes often process authentication via simple shared secrets passed in headers. Using strict equality (`===`) for these comparisons is a common anti-pattern that creates timing side-channels, even for internal or "non-critical" analytics endpoints.
**Prevention:** Always use `constantTimeEqual` from `@/lib/constant-time-equal` for comparing secrets, API keys, or tokens. Ensure that inputs from headers are explicitly null-coalesced to strings (e.g., `?? ''`) to satisfy type requirements before comparison.

## 2026-05-18 - Missing CSRF Protection on Cart Validate Endpoint

**Vulnerability:** The `POST /api/cart/validate` endpoint accepts a JSON payload to validate a cart's contents. Because it uses the `POST` method but lacks the standard CSRF protection check, it violates the monorepo's defense-in-depth policy that all mutation-like endpoints should enforce CSRF token validation.
**Learning:** Even if an endpoint's primary function is validation or returning read-like data, if it accepts a `POST` request (especially one accepting JSON input or capable of triggering side effects inadvertently), it must still implement CSRF protection. Also, unit tests for Next.js routes must instantiate `NextRequest` (instead of standard `Request`) so that middleware utilities like `checkCsrfProtection`, which inspect `request.nextUrl`, can function correctly without causing 'undefined' errors.
**Prevention:** Always verify that every new `POST`, `PUT`, `DELETE`, or `PATCH` API route runs `const { valid, response } = await checkCsrfProtection(request);` inside its structured `try/catch` error flow. Ensure tests use `NextRequest` and properly mock the `checkCsrfProtection` utility.
## 2026-05-24 — Missing RBAC in Hero Images Endpoint
**Vulnerability:** Broken Access Control / IDOR (OWASP API1:2023 - Broken Object Level Authorization)
**Learning:** The `GET` endpoint for fetching AI hero images statistics was accessible to any authenticated user because it lacked the `is_platform_admin` check. Furthermore, when implementing the fix, `getMerchantForApiRequest` should not be used to check for platform admins, because a platform admin might not have a merchant account attached, leading to a 404. Instead, the centralized `getPlatformAdminAuth` helper must be used.
**Prevention:** Always ensure that `GET` endpoints fetching platform-wide data, especially under `/api/admin`, properly verify platform admin privileges using `getPlatformAdminAuth()`.
**Source:** https://owasp.org/API-Security/editions/2023/en/0x11-t10/ 2023
## 2026-06-20 — Tenant-scoped RPCs for Bulk Variant Sync
**Vulnerability:** Broken Access Control / IDOR (OWASP A01:2021) / CWE-284
**Learning:** Supabase array `upsert()` cannot be safely constrained by route-level tenant filters for existing rows; a payload containing another merchant's variant ID can match the primary key before merchant ownership is enforced.
**Prevention:** Use one transactional Postgres RPC for tenant-scoped bulk variant synchronization. The RPC must validate the product and every existing variant ID against `product_id` + `merchant_id` before any stale visible variants are deleted, preserve hidden inventory-anchor rows, and merge omitted optional fields with the stored row rather than overwriting them with route defaults.
**Source:** Supabase/Postgres RPC and RLS guidance; OWASP Broken Access Control.
## 2026-11-08 — Open redirect fix in blog preview
**Vulnerability:** Open Redirect in `apps/web/src/app/api/blog/exit-preview/route.ts` (OWASP A01:2021 – Broken Access Control / CWE-601: URL Redirection to Untrusted Site)
**Learning:** Next.js dynamic routing and route handlers are easily prone to open redirects if they accept a URL as a parameter directly without sanitization, like `redirect(searchParams.get('callbackUrl'))`.
**Prevention:** Use the `sanitizeRelativeRedirectPath` primitive from `@/lib/auth-redirect` to ensure redirects stay on-origin unless explicitly intended to go to known, safe domains.
**Source:** https://cwe.mitre.org/data/definitions/601.html verified on 2026-11-08
