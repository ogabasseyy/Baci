# Task 6 — integration and OAuth nonce re-review

**Reviewed production commit:** `7d094e59b6` (`1896953959..7d094e59b6`).
**Nonce commits reviewed separately:** `424590629c` and `1896953959`.
**Reports read:** `task-6-report.md`, `task-6-oauth-nonce-report.md`, and the
retained Meta, TikTok, and Snapchat implementation reports.

The requested review package was generated from `1896953959..HEAD`. `HEAD`
had advanced concurrently to `4d89791f4b` (a Meta schema-test formatting-only
commit), so findings below are anchored to the exact Task 6 production commit
and the two explicitly requested nonce commits.

## Verdicts

- **Specification: BLOCK.** The social cards, labels, currency separation,
  legacy click attribution, and credential-free response are present, but the
  spend projection is not bound to each connection's currently selected ad
  account. In addition, selected-merchant context is applied to dashboard reads
  but not to connect/discovery/selection/sync controls. Both defects can make a
  merchant act on or view reporting for a different account/merchant than the
  dashboard currently represents.
- **Quality: BLOCK.** Focused tests and scoped Biome are green, but they do not
  cover the account-switch, selected-merchant-control, Google read-error, or
  account-timezone boundary cases below. A touched dashboard mutation also
  still accepts unvalidated JSON despite the plan's Zod requirement.
- **OAuth nonce hardening: PASS for deterministic source evidence, with a live
  database HOLD.** Google, Meta, and TikTok reserve before redirect and consume
  after signed/cookie/user/merchant/permission validation but before provider
  exchange. The RPC argument names and generated types match; both functions
  return `false` on null input, reject unsupported providers/callbacks, bind the
  authenticated user and merchant, enforce the expiry window, and delete the
  exact nonce so replay returns `false`. Hashes/inventory tests pass. This is
  not runtime proof: migration replay, grants/RLS, clock behavior, and
  concurrent consume must still be exercised against isolated Supabase.

## Findings

1. **[Critical] Dashboard spend is aggregated across every historical ad
   account, not the currently selected account.**

   `fetch-ad-reporting-snapshots.ts` queries Google rows by merchant/provider
   only (lines 34-43) and social rows by merchant/provider/date only (lines
   52-60). The social projection does not even select
   `provider_customer_id`; `buildSocialAdsAnalyticsSnapshot` filters only on
   `row.provider` (line 146), then derives provider and cross-provider totals
   from those unbound rows (lines 189-207). The Google snapshot receives the
   account ID but maps and sums every row without comparing it to
   `connection.provider_customer_id` (lines 48-87).

   This is deterministically unsafe with the shipped schema: spend uniqueness
   includes `provider_customer_id`, while `set_merchant_ads_account` changes
   the connection selection without deleting the previous account's rows.
   Meta/TikTok/Google disconnect also retains spend rows. After an account
   change—or a disconnect/reconnect before a new selection—the card can show
   old and new account spend, impressions, clicks, conversions, and currencies
   together. For social connections with no selected account, old rows make
   `metrics` non-null, so the UI renders those metrics instead of the intended
   “Choose a reporting account” state.

   Filter every provider's rows to the exact active connection account before
   summing, and expose no metrics when no active selected account exists. Add
   regressions for account A to account B switching, reconnect-without-
   selection, old/new currencies, and Google plus all three social providers.

2. **[Critical] Selected-merchant scoping stops at reads; account controls can
   operate on a different merchant than the dashboard being displayed.**

   Category reads correctly send `x-baci-merchant-id`, and the analytics route
   validates/resolves it. In contrast, `SocialAdsAccountControls` calls
   discovery, account PATCH, and sync without a merchant header (lines 92-131
   and 156-173); `GoogleAdsAccountPicker` does the same (lines 69-144); connect
   links contain only the provider path (`social-ads-reporting-card.tsx` line
   114). The provider routes resolve `getUserAccess(auth.supabase)` with no
   requested merchant context (for example Meta accounts lines 148-172), so
   they target the RPC's default merchant instead of the merchant selected in
   `useMerchant()` and shown by `/api/analytics/ads`.

   A multi-merchant owner/staff user can therefore view merchant A's analytics
   and select/sync/connect the provider connection for merchant B. This remains
   permission checked, but it is a cross-merchant integrity failure and is
   especially risky for an account that is both merchant owner and platform
   administrator. Pass the selected merchant through every control, validate
   it server-side with `getMerchantForApiRequest`, and bind it into the signed
   OAuth state. Because a navigation link cannot send the custom header, the
   connect initiation needs an explicit validated merchant mechanism rather
   than silently falling back. Add tests that set merchant A in the dashboard
   while the user's default access RPC points to B.

3. **[Important] Google reporting retains several unwired or falsely healthy
   states.**

   A Google connection read failure makes `googleAds` undefined, which the card
   renders as disconnected. A spend-row read failure is replaced with an empty
   array, which an active connection renders as “Metrics will appear after the
   first reporting sync.” An actual connection `status = 'error'` is reduced to
   `connected: false`; the mapper consequently selects `disconnected` rather
   than its supported `error` state. No stale/data-error marker is returned.
   Once metrics exist, the card renders neither **Sync now** nor **Change
   account**, even though both account and sync routes exist. The card also has
   CTR/CPC/reporting-window branches, but the API snapshot never supplies
   CTR/CPC or `startDate`/`endDate`, so those branches are unreachable for this
   response.

   Preserve connection and data-read status explicitly, derive freshness,
   expose safe existing-account controls in the metrics state, and either wire
   the supported derived metrics/window or remove their dead presentation
   contract. Label Google conversions as provider-attributed, matching the
   separation already applied to social conversions.

4. **[Important] Account-local reporting dates are converted through UTC, so
   dashboard windows can include/exclude the wrong provider day.**

   The browser sends `Date.toISOString()` (`fetch-analytics-category-data.ts`
   lines 197-207), and the API reduces those instants with
   `toISOString().slice(0, 10)` before querying account-local `spend_date`
   (`analytics/ads/route.ts` lines 140-144). The provider rows explicitly store
   account-local dates and timezones. A browser/account west or east of UTC can
   therefore shift a selected calendar day. The orders query also treats the
   selected end date as an exact instant (`lte` at line 127); the current date
   picker supplies local-midnight dates, so most of the visible end day can be
   excluded from legacy attribution.

   Define the analytics contract as calendar dates (preferred) or normalize
   inclusive start/end instants deliberately, then map provider spend dates in
   the selected account timezone. Add non-UTC and end-of-day regressions.

5. **[Important] The touched dashboard-preference mutation still bypasses the
   mandatory Zod input contract.**

   `POST /api/dashboard/preferences` authenticates first and checks CSRF, but
   lines 110-143 destructure and persist arbitrary JSON without a schema,
   bounded layout size, widget-ID allowlist, or a malformed-JSON 400 path. A
   malformed body falls into the generic 500 handler; a very large or invalid
   object can be persisted. Add a dedicated Zod schema for responsive/legacy
   layouts and `visible_cards`, return 400 on parse failure, and test malformed,
   oversized, invalid-widget, and valid responsive bodies.

## Confirmed behavior

- The social projection uses exact decimal-string addition and keeps each
  currency separate. It does not manufacture cross-currency ROAS.
- Meta, TikTok, and Snapchat provider conversions remain separate from Baci
  paid orders/revenue. Snapchat is correctly labelled **Swipe Ups** and
  **Snapchat-attributed purchases**.
- Legacy `fbclid`, `ttclid`, `gclid`, and `sccid` order attribution remains in
  the legacy platform section rather than being added to provider conversions.
- Analytics table projections omit access/refresh ciphertext, client secrets,
  and provider response bodies. The response sentinel test is meaningful for
  the legacy CAPI token; no leakage was found in inspected client types or
  rendered provider data.
- Social disconnected, reauthorization-error, never-synced, fresh, stale, and
  spend-read-error states are represented. The defects above concern account
  binding, merchant control context, and the retained Google path.
- The operations guide correctly distinguishes provider developer-app
  approval/access review from a commercial social-media partnership and lists
  current owner-controlled activation gates.

## Verification performed

- Generated review package from `1896953959..HEAD`; the package resolved to
  `review-1896953959..4d89791f4b.diff` because of the concurrent formatting-only
  commit described above.
- `git diff --check 1896953959..7d094e59b6` — passed.
- Focused Vitest: 14 files / 35 tests passed, covering analytics snapshots,
  route response, social mapper/cards/controls, Google/Meta/TikTok nonce
  connect/callback behavior, and migration/replay inventory contracts.
- Scoped Biome: 13 reviewed runtime/test files passed with no findings.
- The Task 6 report's broader focused result (29 files / 103 tests), migration
  contract result (5 files / 10 tests), and unrelated-worktree typecheck/lint
  blockers were reviewed but not recharacterized as full-suite proof.

## Release gates distinct from code findings

- Replay migrations `20260821180000` through `20260821180007` against isolated
  Supabase and exercise owner/least-privileged staff RLS/RPC behavior,
  concurrent one-time nonce consumption, rollback, and rotated-token CAS.
- Do not enable TikTok or Snapchat across multiple instances until their
  process-local rate gates are replaced or fronted by a shared limiter/queue.
- Meta App Review/access tier/business verification, TikTok app/scopes and
  exact state-echo sandbox proof, and Snapchat Business Manager activation/
  PKCE decision remain owner/provider gates. No live credentials, consent, or
  provider calls were verified in this review.

No production code was changed by this re-review.
