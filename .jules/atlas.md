# Atlas Notes

## 2026-06-28 — Shared Intl currency formatting for mobile admin totals

**Learning:** `Intl.NumberFormat` should be the shared source for currency display so locale, symbol placement, grouping, and fallback behavior stay consistent across markets. Avoid isolated `en-NG` formatter caches in components/helpers.
**Action:** Route mobile-admin totals through the shared `formatCurrency` utility and validate merchant currency codes before formatting.
**Source:** MDN Intl.NumberFormat docs and Baci mobile-admin currency utilities, verified 2026-06-28.

## 2026-07-01 — Storefront purchase history should use merchant currency

**Learning:** Hardcoded `Intl.NumberFormat('en-NG', { currency: 'NGN' })` in storefront components creates market-readiness drift when merchant context already exposes centralized country/payout currency formatting.
**Action:** Use the storefront `useCurrency()` hook for purchase-history prices and cover the delegation with a colocated regression test.
**Source:** MDN Intl.NumberFormat docs and `apps/web/src/hooks/use-currency.ts`, verified 2026-07-01.
2025-02-14 — Atlas: Extract budget hardcoded format to shared money util
Learning: Manual en-NG and hardcoded ₦ budget formatting should be routed through formatMoney from @baci/shared/money to support multi-currency seamlessly.
Action: Replace manual Intl formatting loops with formatMoney and use try/catch to maintain fallback behaviour for unrecognized currencies.
Source: packages/shared/src/lib/search-suggestions.ts
