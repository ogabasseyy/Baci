# Architectural Decisions

## ADR-001: Supabase over Firebase
We use Supabase for PostgreSQL, RLS, and open source. Do NOT suggest migrating to Firebase or adding Firebase SDK.

## ADR-002: Biome over ESLint
We migrated from ESLint to Biome. Do NOT add `.eslintrc` files or suggest ESLint plugins.

## ADR-003: Server Components by Default
All new components should be Server Components unless they need interactivity. Justify every `'use client'` directive.

## ADR-004: React Compiler for Memoization
React Compiler is enabled. Do NOT add manual `React.memo`, `useCallback`, or `useMemo`.

## ADR-005: pnpm + Turborepo
This is a pnpm monorepo. Do NOT use npm or yarn. Use `pnpm turbo <command>` for build/lint/test.

## ADR-006: Theming via CSS Variables
Merchant brand colors use CSS variables (`var(--store-primary)`, etc.). Never hardcode colors in storefront components.

## Key Contexts

- `AuthContext` — User authentication state
- `ProductContext` — Product catalog management
- `StorefrontContext` — Storefront data
- `CustomerAuthContext` — Customer auth (separate from merchant)

## Key Hooks

- `useMerchant()` — Merchant data, permissions, staff
- `useCart()` — Shopping cart state
- `useAuth()` — Authentication state
- `useLoyalty()` — Loyalty program
- `useMerchantFeatures()` — Feature flags

## Important Files

- `docs/PRODUCT_FEATURES.md` — Canonical product capability catalog across web, mobile-admin, mobile-storefront, and API (also check `apps/web/src/config/platform-features.ts`)
- `proxy.ts` — Request middleware (auth, rate limiting, domains)
- `src/env.ts` — Environment variable management
- `src/config/business-types.ts` — Business type configuration (single source of truth)
- `next.config.ts` — Next.js configuration
- `biome.json` — Linter/formatter config
