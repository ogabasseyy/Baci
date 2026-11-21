# Atlas Notes

## 2026-06-28 — Shared Intl currency formatting for mobile admin totals

**Learning:** `Intl.NumberFormat` should be the shared source for currency display so locale, symbol placement, grouping, and fallback behavior stay consistent across markets. Avoid isolated `en-NG` formatter caches in components/helpers.
**Action:** Route mobile-admin totals through the shared `formatCurrency` utility and validate merchant currency codes before formatting.
**Source:** MDN Intl.NumberFormat docs and Baci mobile-admin currency utilities, verified 2026-06-28.

## 2026-07-01 — Storefront purchase history should use merchant currency

**Learning:** Hardcoded `Intl.NumberFormat('en-NG', { currency: 'NGN' })` in storefront components creates market-readiness drift when merchant context already exposes centralized country/payout currency formatting.
**Action:** Use the storefront `useCurrency()` hook for purchase-history prices and cover the delegation with a colocated regression test.
**Source:** MDN Intl.NumberFormat docs and `apps/web/src/hooks/use-currency.ts`, verified 2026-07-01.
## 2026-07-02 — Trade-in estimator should keep compact NGN formatting

**Learning:** `/api/ai/grade-device` returns un-converted Naira (`NGN`) integer prices, so delegating directly to `useCurrency().formatCurrency()` both introduces `.00` decimals on whole-number estimates and mislabels NGN values as another merchant currency without conversion.
**Action:** Format device-grading estimates through shared `formatCurrency(amount, 'NG', COMPACT_OPTIONS)` from `@/lib/currency` instead of raw `'₦' + value.toLocaleString()` templates or `useCurrency()`.
**Source:** `apps/web/src/lib/currency.ts` and `apps/web/src/app/api/ai/grade-device/route.ts`.

## 2026-11-18 — Extract budget hardcoded format to shared money util

**Learning:** Manual en-NG and hardcoded ₦ budget formatting should be routed through `formatMoney` from `@baci/shared/money` to support multi-currency seamlessly.
**Action:** Replace manual `Intl` formatting loops with `formatMoney` and use `try/catch` to maintain fallback behavior for unrecognized currencies.
**Source:** `packages/shared/src/lib/search-suggestions.ts`
