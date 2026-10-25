# Plan: Map Petrock (DHRU Fusion Pro) onto the Baci IMEI checker — richer checks + a clean carrier-unlock funnel

> Historical integration plan. See [current contract](./petrock-current-contract.md) and [customer service map](./catalog-review-20261025/customer-service-map.md) for the 2026-10-25 supplier-contract corrections and current catalog baselines.

> Execution-ready revision. Every earlier "corrected later" note has been folded into the body — read top-to-bottom, no supersession section. Reviewed twice (external agent + Fable meta-review); all blocking findings incorporated.

## Context

Baci's storefront IMEI checker is single-provider (**Sickw**): a synchronous, instant, ~$0.02–$0.12 info lookup that debits the customer wallet, calls Sickw, refunds on failure. It exposes a curated 29-tier catalog across device categories (phone/tablet/laptop/watch) and brands.

**Petrock** (`https://api.petrock.biz/api/reseller/v1`, a DHRU Fusion Pro reseller panel; Bearer JWT; USD) offers far more: 2,175 products, of which the relevant `type:"imei"` slice splits into **info checks** (cheaper + richer than Sickw on many checks) and **carrier factory-unlock services**. The reseller balance is **operational data** (a small live float; alert at <$25) — never a design constant.

**Goal:** (1) make the checker *richer* by adding Petrock's info checks behind a provider abstraction; (2) after a check, if a device is **non-blacklisted but carrier/SIM-locked**, offer the matching Petrock **clean carrier unlock** when one is available — a check→unlock funnel.

**Decisions (user-confirmed, final):**
- Full vision, phased end-to-end.
- **CLEAN carrier SIM-unlocks ONLY.** No blacklist-removal/"unbarring/cleaning", no iCloud/FMI bypass, no MDM/FRP removal, no owner-info removal, no Xiaomi Mi-account. (Rationale in "Key policies".) Carrier unlocks take a single IMEI field → no owner-info/PII collection in v1.
- **Blacklisted / lost / stolen → never offer an unlock** (the only Petrock products that "unlock" these are laundering variants we exclude; upstream carriers refuse them anyway).
- **Wallet-funded everywhere.** The web wallet top-up already exists end-to-end (see §5) — Phase 1 only wires it into the checker.
- Multi-currency (NGN + USDT via Juicyway) is a separate design pass gating Phase 4 go-live (§5).
- Unlocking is **not instant** (mostly 1–7 days) → set expectations up front and notify the customer on completion/rejection.

### API contract + empirically-verified behavior (5 live test orders, ~$0.19)

`GET /account` (balance/currency), `GET /products`, `POST /order` (body `[{product_uuid, fields:[{feedback_url, reference_id, Quantity, <exact field name>, ...}]}]`), `GET /order?order_uuid=…`. Verified against the live API:

- **Async even for cheap checks:** a $0.019 blacklist check took **~42 s** (`new → in-process → success`). Orders are NOT synchronous. This is the single most important design driver.
- **`GET /order` requires `order_uuid`**; `?reference_id=` → `400`. `POST /order` returns `order_uuid` **synchronously** (nested at `data[0][0].order_uuid`) and echoes our `reference_id`.
- **Result** is an HTML string in `data.replay`: `<br>`-separated `Key: Value`, with status encoded by color in **either** `<span style="color:…">` **or** `<font color=HEX>` (green/`008000`=good, red/`FF0000`=bad). Status vocab: `new`, `in-process`, `success`, `reject`.
- **Field names are byte-exact and inconsistent** (trailing-space traps): 688 = `"IMEI or Serial Number "`, 698 = `"Serial Number "`, 699 = `"IMEI/SN"`, 704 = `"Serial Number"`, 705 = `"IMEI"`, 693 = `"IMEI or Serial Number"`. Any `.trim()` in the client breaks the order.
- **Notification:** DHRU emails the *reseller account* on completion (`petrock@dhrufusion.com`) — that's account-level, not per-customer, and NOT proof the per-order `feedback_url` HTTP callback fires. Callback firing is **unverified** (capture was blocked this session). Design accordingly (cron-primary; §4).

---

## Recommended approach

**ADD Petrock behind a provider abstraction; pin each logical check to one provider via a server-side binding map.** Not replace (Sickw keeps Watch, Xiaomi Mi-lock, iCloud-FMI, activation, demo, and any tier spanning device categories Petrock can't serve). Not per-request dynamic routing.

Seam: `apps/web/src/app/api/storefront/imei-check/route.ts` calls `requestSickwCheck(...)` with `serviceTier.providerServiceId` after the wallet debit — that single call site becomes a registry dispatch. `apps/web/src/app/api/storefront/imei-check/sickw-client.ts` is dead code (only its own test imports it) — delete in Phase 2.

### 1. Provider abstraction (server-only) + binding placement

New server-only module `apps/web/src/lib/imei-providers/` (modeled on `apps/web/src/lib/shipping/`). NOT in `packages/shared` (holds secrets; mobile never calls providers — it calls the route). Files (each with colocated Vitest): `types.ts`, `registry.ts`, `sickw-provider.ts`, `petrock/{petrock.constants.ts, petrock.schemas.ts, petrock-client.ts, petrock-parser.ts, petrock-provider.ts}`.

**Binding placement — CORRECTED.** Do NOT put `ImeiProviderRef` in `apps/web` and reference it from `packages/shared` (`shared` cannot depend on `apps/web`, and mobile would bundle Petrock uuids). Instead: **a web-side binding map** keyed by tier key, in `apps/web/src/lib/imei-providers/tier-bindings.ts`:
```ts
type ProductBinding = {
  productId: string;           // Petrock uuid (or Sickw id) — IMEI-input product
  serialProductId?: string;    // Petrock serial-input product (e.g. 704 vs 705)
  orderFieldName: string;      // byte-exact Petrock fields[].name (trailing spaces!)
  serialOrderFieldName?: string;
  costUsd: number;             // Petrock cost — drift-guard/margin BASELINE (shared tier.costUsd is the SICKW cost).
  serialCostUsd?: number;
};
type ProviderBinding = {
  provider: 'sickw' | 'petrock';
  deviceCategories: readonly ImeiDeviceCategory[];  // device families THIS product actually serves (704/705 = ['smartphone','tablet'])
  fallback?: ProductBinding;                          // full binding — its field name + cost may differ
} & ProductBinding;
const TIER_BINDINGS: Partial<Record<ImeiServiceTierKey, ProviderBinding>> = { … };  // keyed by tier KEY (tiers carry no `.key`)

// THREE gates: global flag + fail-closed per-tier allowlist (default empty) + client async capability.
function resolveBinding(tierKey, tier, deviceCategory, clientSupportsAsync): ProviderBinding {
  // clientSupportsAsync guards OLD clients: a client that can't handle a 202 pending body would reject it
  // (no `data`), clear its idempotency key, and retry with a NEW key → a SECOND debit+order. Fail to Sickw.
  if (!isPetrockEnabled() || !petrockEnabledTiers().includes(tierKey) || !clientSupportsAsync) {
    return sickwBinding(tier);  // off / not-allowlisted / old client → legacy synchronous Sickw
  }
  const b = TIER_BINDINGS[tierKey];
  if (!b) return sickwBinding(tier);
  // multi-device tier: use Petrock ONLY when the device is known AND this product serves it; else Sickw.
  if (tier.deviceCategories.length > 1 && (!deviceCategory || !b.deviceCategories.includes(deviceCategory))) {
    return sickwBinding(tier);
  }
  return b;
}
```
`sickwBinding(tier) = {provider:'sickw', productId: tier.providerServiceId, orderFieldName:'imei', costUsd: tier.costUsd, deviceCategories: tier.deviceCategories}`. `petrockEnabledTiers()` reads env `PETROCK_ENABLED_TIERS` (comma-list, **default empty** — nothing flips until explicitly listed). `packages/shared` untouched; Petrock uuids never enter the mobile bundle. **`gsxPremium` note:** its tier `identifier` is `'serial'`, so Petrock 705's IMEI path is unreachable — change the tier identifier to `'both'` or bind only serial product 704; and Mac/Watch `gsxPremium` traffic **stays Sickw** (a Mac binding to 698 is valid only once 698 fixtures prove full GSX-tier coverage — do NOT auto-map).

Provider interface (plain objects): `check(req) → ImeiProviderOutcome` (place+return, see async model), `parseResult(raw, checksIncluded)`, `getBalanceUsd()`, `getProductSnapshot(productId)`, `isConfigured()`.

### 2. Async model — place-and-return, NOT poll-in-request (the core correction)

Because orders take ~40 s+ and **mobile hard-aborts the request at 30 s and requires an immediate `success + data` body** (`apps/mobile-storefront/app/imei-check/index.tsx:129`, and the client rejects any response body without `success + data` at `index.tsx:183`), a synchronous poll-within-request is wrong. Instead:

1. Route — **transactional write-ahead ordering (crash-safe, preflight-before-debit):**
   - **(a) Preflight BEFORE the wallet debit:** resolve the binding + verify provider configured, tier allowlisted + client-capability present, catalog snapshot fresh, field-name and price-drift OK. Any failure → `503` **with no debit** (never debit-then-refund on a known-bad config).
   - **(b) Prepare the submission identity in memory:** generate `reference_id` plus the feedback token/hash before touching money.
   - **(c) Debit + durable classification in ONE database transaction:** call a new Petrock-specific RPC (for example, `redeem_imei_wallet_and_begin_provider_submission`) that validates the pending lookup, debits the wallet, persists `reference_id`, feedback token/hash, `provider`, `provider_attempt_started_at`, and transitions the lookup to **`provider_submitting`** atomically. Do **not** call the existing debit RPC and then update the lookup in a second transaction — a process crash between those writes would charge the customer while leaving an ordinary `pending` row with no provider submission.
   - **(d)** `POST /order`.
   - **(e)** On response → store `order_uuid`, transition to **`pending_provider`**.
   - **(f)** On POST timeout → **`submission_unknown`** (no refund).
   - **(g)** Return **`202` pending** (or `200 complete` if it resolved within the short place-window).
   **Crash safety:** if the transactional RPC fails, neither the debit nor `provider_submitting` transition commits. A crash after (c) but before (e) leaves a charged, durably classified `provider_submitting` row carrying `reference_id`/token — reconciliation promotes stale `provider_submitting` → `submission_unknown` + ops alert (the upstream order may exist and may have charged; recovery needs the `order_uuid` via callback/dashboard/support — the cron can escalate but cannot poll without it). **Never retry the POST or refund on a stale `provider_submitting`.**
2. Client (web + mobile): on `pending`, show "**We're checking — usually under a minute**" and **poll `GET /api/storefront/imei-check/[lookupId]`** (authenticated, customer-scoped) until terminal, with refresh/app-restart resume from `lookupId` (see Client resume + polling contract below).
3. Server resolves the lookup when the order completes: the status endpoint re-fetches `GET /order?order_uuid=` (source of truth), OR the reconciliation cron does. On `success` → cache result + terminal; on `reject` → map the customer side to existing `refundAndCacheFailure`. Reconcile any upstream Petrock balance credit separately; customer refund correctness must not depend on the unverified claim that Petrock always auto-refunds rejected orders.

**The exact contract (must be specified before code — no "TBD"). Additive: existing clients require `success:true`/`error`, so keep them — `status` is ADDED, not a replacement** (both web `imei-checker.tsx:143` and mobile `index.tsx` reject a body without `success:true`):
- `POST /api/storefront/imei-check`, discriminated on `status` but always carrying the legacy field: `200 {success:true, status:'complete', data: ImeiCheckResult, tier}` (Sickw or a Petrock order resolved in the short place-window) · `202 {success:true, status:'pending', lookupId, pollAfterMs}` · `4xx/5xx {success:false, status:'error', code, error}` (keep `error`, NOT `message` — existing terminal bodies unchanged, just gain `status:'error'`).
- `GET /api/storefront/imei-check/[lookupId]` mirrors it: `200 complete` | `202 pending {pollAfterMs}` | terminal `error`, all with the `success` field. Customer-scoped (RLS/`customer_id`), rate-limited. Old clients that ignore `status` still work on the `complete`/`error` bodies; only the new `pending` path needs new client handling.
- **Client capability gate (old-client safety — the key protection):** every request declares `clientCapabilities` (body field, parsed by `imeiCheckSchema`, or an `X-Client-Capabilities` header) including `'imei-async-v1'`. The route computes `clientSupportsAsync = caps.includes('imei-async-v1')` and passes it into `resolveBinding`; **a request WITHOUT the capability resolves migrated tiers to synchronous Sickw**, so an un-updated app install NEVER receives a `202 pending` it would mishandle (reject → clear idempotency key → retry with a new key → a second debit+order). This is a per-request gate — it holds regardless of how many users have updated, which is why the flip is safe.
- **Idempotent replay:** a replay of a `provider_submitting` / `pending_provider` / `submission_unknown` lookup (same Idempotency-Key) returns the SAME `202 + lookupId` and **NEVER places another `POST /order`** — NOT today's `409` idempotency-conflict. A replay of a resolved lookup returns its cached terminal body. Extend the existing `findLookupByIdempotencyKey`/`mapExistingLookup` replay path to handle all three non-terminal Petrock states.
- **Route catch restructuring (critical):** today the outer `catch` auto-refunds any post-debit exception (`route.ts:428-430 refundAndCacheFailure`). A Petrock `POST /order` network timeout MUST be caught at the provider call, persisted as **`submission_unknown`** (no refund), and returned as `202 pending` — it must NOT fall through to the auto-refund catch. Only genuine provider errors (`reject`, 4xx) take the refund path.

**Client resume + polling contract (web + mobile):**
- **Persist on submit** `{lookupId, tier, createdAt}` — web `localStorage` keyed by `(merchantId, customerId)`, mobile `AsyncStorage`; **clear on terminal status or logout**. On page-refresh / app-open with a stored pending lookup → resume polling from `lookupId`.
- **Backoff:** server returns `pollAfterMs` (e.g. 2s→5s) + enforces a `next_poll_at` floor and rate-limits the status endpoint; client honors it. Stop client polling after a max wall-clock (~5 min) → "we'll notify you / check later" (the reconciliation cron still resolves it).
- **Concurrency:** the status endpoint AND the reconciliation cron can both transition a lookup — every terminal write is a **conditional atomic update** (transition only FROM `pending_provider`/`submission_unknown`, single service-role writer) so a client poll and a cron tick can't double-resolve or double-refund.

This is a **new money path**, not "no new money path": `imei_lookups.status` is a hardcoded CHECK enum (`20260515142000_imei_lookups_table.sql`) → needs an append-only constraint-altering migration adding **`provider_submitting`, `pending_provider`, `submission_unknown`**, plus the transactional debit-and-classify RPC described above.

**POST-timeout policy.** If the `POST /order` request itself times out (no response body → no `order_uuid`), the order MAY have executed and charged the reseller. Set status **`submission_unknown`**, **never auto-refund**, raise an ops alert, and resolve by (a) a validated `feedback_url` callback, if capture proves it fires and carries enough order identity, or (b) manual reconciliation. Do NOT auto-retry or fallback. This is a **hard launch gate for Phase 4** (large amounts). Exposure is TWO-sided: the reseller's ≤$0.75 upstream cost AND the customer's already-debited NGN (₦300–₦33k for a check) held in limbo. **Ops SLA for `submission_unknown`:** on entry, raise an ops alert and start a bounded confirmation window. The reconciliation cron can only escalate a row that lacks `order_uuid`; it cannot discover or poll the order. Unless a validated callback supplies the identity, **manual recovery obtains the `order_uuid` from the Petrock dashboard / support / `petrock@dhrufusion.com` account email, THEN polls `GET /order?order_uuid=`** — the API CANNOT query by our `reference_id`. If non-submission is CONFIRMED, manually refund the customer and message them ("we couldn't place your check — you've been refunded"); if it did run, resolve normally. Never auto-refund `submission_unknown` (the order may have executed). **Phase-2 launch gate: prove this manual-recovery workflow in an operational drill before enabling any tier.**

### 3. Catalog mapping (curation rule + corrected table)

**Rule (tie-break): Coverage → Speed → Price → Source stability.** Pick the cheapest product whose result fields **provably** cover the tier's `checksIncluded` (verified by a fixture-to-`checksIncluded` contract test on a real order result — a product-name match is NOT sufficient), restricted to fast turnaround.

| Check (tier key) | Petrock uuid | Petrock $ | Current Sickw / retail | Action |
|---|---|---|---|---|
| `full` | 688 (fb 694) | $0.031 | Sickw 61 @ $0.10 | MIGRATE **only if** fixture proves 688 covers `full.checksIncluded` (14 fields incl. `refurbished`,`demoUnit`,`purchaseDate/Country`). Live 688 did NOT return refurb/demo/purchase → **coverage unproven; keep Sickw or evaluate 695** until proven. |
| `blacklist` | 1955 (fb 684,750) | $0.019 | Sickw 54 @ $0.04 | MIGRATE (fixture-check) |
| `gsxPremium` | 705 / serial 704 | $0.75 | Sickw 63 @ $2.00, **retail ₦32,700** | Petrock 704/705 are **iPhone/iPad-only**, but `gsxPremium` spans **smartphone/tablet/laptop/watch** → do NOT blanket-migrate. Migrate iPhone/iPad traffic only (needs device context §4); **Mac stays Sickw unless a 698 fixture proves every `gsxPremium` `checksIncluded` field**; Watch→Sickw. Margin at ₦32,700 goes ~10×→~27× — flag the keep-vs-cut retail decision. |
| `knoxGuard` | 699 | $0.06 | Sickw 82 @ $0.30 | MIGRATE (fixture-check); consider retail cut |
| `simLock` | 693 (fb 716) | $0.019 | Sickw | MIGRATE (fixture-check) — carrier-bearing, needed by the funnel |
| `samsung`, `pixel` | 741, 721 | $0.057, $0.096 | Sickw 80, 42 | MIGRATE (fixture-check) |
| `icloudPro` (was mis-mapped as `icloudCleanLost`) | 706 / serial 712 | $0.026 | **Sickw 66 @ $0.22/₦3500** | MIGRATE — this is the real 8×-cost win. **NOTE:** `icloudCleanLost` is a DIFFERENT tier (Sickw `4` @ $0.03/₦500) — migrating it saves ~$0.004, skip it. |
| **NEW checks** | 1941 eSIM; 1964/1966 refurb/replaced; 1963 partNo; 746/749/1957 US carrier finance; 700 Knox enroll; 1990 Samsung sold-by; 738/728 OnePlus/Transsion; 698/713 Mac; 666/1943 premium | $0.04–$1.85 | — | ADD in Phase 3 (single IMEI/serial field) |
| **Network-specific checkers** | AT&T 1957; T-Mobile 746/1958/701/640; Verizon 749/1959/1960; TracFone 743; Xfinity 2015; JP 729/731/730/732/733 | $0.037–$0.09 | — | ADD (richer US-market intel; also the funnel eligibility step §4) |
| KEEP SICKW | — | — | — | `icloud`(FMI 3), `activation`(88), `mdm`(81), `demoUnit`(85), `icloudCleanLost`(4), Xiaomi `miLock`(206/58), all Watch, any multi-device tier lacking device context |

New `ImeiCheckField` values: `esimCompatibility|financeStatus|knoxEnrollment|soldBy|wifiMac|devicePhoto`. New optional `ImeiCheckResult` fields (`sickw-parser.types.ts`) **and** mobile `ImeiResultSchema` (`apps/mobile-storefront/lib/validation/commerce-schemas.ts`) — Zod strips unknown keys, so a field missing from the mobile schema is invisible on mobile. New fields must be **optional** there. Six new result-card renderers on web + mobile.

**Result parsing:** extract the generic label-splitter from `sickw-parser-helpers.ts` into a shared `label-map-parser`; `petrock-parser.ts` supplies a Petrock alias table and handles BOTH color HTML formats. Each alias gets a fixture test from a real result before its tier goes public.

### 3b. Categorization & supported-device mapping (the hard curation problem)

The 2,175-product catalog → **817 `type:"imei"`** (the other 1,358 — `server` 682, `game` 252, `gift_card` 210, `digital` 154, `remote` 55, `file` 5 — are noise; filter by `type`). Within the 817:
- **Info-checks** (~92 in C163/C164/C165 + network-specific checkers) → curated to the §3 shortlist. Tractable; done.
- **Carrier unlocks:** **~43 network-unlock categories** (AT&T C210/C209, T-Mobile US C159, UK C222/C224/C229, Canada C235/C240, Samsung ×6 regions C238/C239/C240/C304/C458/C459, plus ~30 country networks — Australia/Austria/Croatia/France/Ireland/Japan/Mexico/Philippines/Sweden/EMEA — and brand code-unlocks for LG/Moto/Nokia/Sony/ZTE/Alcatel/Sharp/HTC/Tecno). Each is **model-AND-status-segmented** (AT&T alone ≈58 products).

**The core difficulty: there is NO structured supported-model field.** A product's `fields[]` is only the input (IMEI); which models/statuses it supports is encoded ONLY in the free-text `name` ("All iPhone Models", "Up Till 15 Series", "iPhone 17 Series Only", "Generic Models", "[Past Due Status Only]", "[No Refund For Denial]"). So availability/routing cannot be a live catalog query — it needs a **curation build** (an explicit Phase-4 sub-deliverable, sized as such):

1. **Sync + parse (server-side).** The nightly `sync-petrock-catalog` cron stores every `type:"imei"` product; a **name-parser** extracts structured metadata into `petrock_remediation_products`: `carrier`+`region` (from `cid`), `model_scope` (`{kind:'range'|'set'|'generic', min?, max?, models?}` parsed from the name), `status_segment` (Clean / PastDue / AccountLocked / Wait30Days / NotActive…), `refund_policy`, `success_rate`, `turnaround`. Parser output is a **human-reviewed seed dataset**, never trusted blind (names are messy); `is_active`/`manual_disabled` for ops control.
2. **Device normalization keys off the CHECK RESULT, not marketing text.** The check returns a structured model + Apple generation (live AT&T result: `Model: IPHONE 17 PRO MAX …`, `Generation: … IPHONE18,2`). Normalize that to a canonical model/series key and match against `model_scope`. Ambiguous/unmatched → **suppress the offer** (never sell a model-locked product to an unmatched device).
3. **Availability = a table query** on `(carrier, status_segment matches the eligibility check, model matches model_scope, is_active)`; zero rows → "no service available for this device".

**v1 coverage is a deliberate subset, not all 43.** Start with a few high-demand carriers fully curated (e.g. AT&T, T-Mobile US, UK networks), each with its model×status matrix vetted; expand as curation matures. Enumerate the launch carrier set explicitly before Phase 4 build.

### 4. Pricing (hardcoded curated NGN, cron-guarded)

Keep the customer-facing `price`(NGN) hardcoded in the shared tier files (displayed price must equal the wallet debit; live FX breaks replay/caching). **Provider cost for a migrated tier is `ProviderBinding.costUsd` (server-side), NOT the shared `tier.costUsd`** — the latter stays the legacy Sickw cost. The drift guard and margin reporting compare the live snapshot against the *selected binding's* `costUsd`. New-tier formula: `priceNgn = max(₦300, roundUp100(min(costUsd·FX·10.5, costUsd·FX·3+₦5900)))`, `FX=IMEI_FX_NGN_USD (~1575)`. Anchors verified ($0.04→₦700, $0.06→₦1000, $0.30→₦5000); photoReport ₦9100, gsxMax ₦14700. **Migrated tiers keep current retail** (bank margin) — decide keep-vs-cut per tier (e.g. `gsxPremium` ₦32,700 → ~27× margin; `knoxGuard` candidate cut).

**Ops guard:** `imei_provider_products` snapshot table (service-role only), nightly cron `/api/cron/sync-petrock-catalog` (cron-secret gated) storing live `price_usd/time/orderFieldName/raw`. Order-time **fail-closed 503 `PROVIDER_PRICE_STALE`** if snapshot >48 h stale, `price_usd > binding.costUsd×1.25`, or `orderFieldName` drifted. Alert on >15% drift, low balance, and **NGN/USD spot depreciation** (thin-margin protection). Kill switch: `IMEI_DISABLED_TIERS`.

**Env registration (ALL new vars in `env.ts` + `turbo.json` strict-mode `globalEnv`, else turbo filters them at build):** `PETROCK_API_BASE_URL`, `PETROCK_API_TOKEN`, `PETROCK_ENABLED`, `PETROCK_ENABLED_TIERS`, `IMEI_FX_NGN_USD`, `IMEI_DISABLED_TIERS`, and later `PETROCK_REMEDIATION_ENABLED`.

### 5. Dark-ship / flag semantics — CORRECTED

All 29 tiers are already in `PUBLIC_IMEI_SERVICE_TIERS`, so "append Petrock keys to PUBLIC" only gates **NEW** tiers — it cannot dark-launch **migrated** tiers, and a flag-off `503` would kill live revenue tiers. Correct mechanism:
- **Migrated tiers:** gated by BOTH the global `PETROCK_ENABLED` AND a **fail-closed per-tier allowlist `PETROCK_ENABLED_TIERS`** (comma-list, default empty). `resolveBinding` returns the **legacy Sickw binding** unless the tier is in the allowlist AND the global flag is on (Sickw stays live; no 503). A tier flips independently by adding its key to `PETROCK_ENABLED_TIERS` — that is the technical per-tier flip (turning the global flag on alone flips nothing). 503 only for Petrock-only tiers.
- **New tiers:** gated by omission from `PUBLIC_IMEI_SERVICE_TIERS` until launch.
- **Per-tier flip gate (all must hold before a tier flips to Petrock):** (a) the **client capability gate** (`imei-async-v1`) is shipping in current clients AND enforced server-side — old clients without it auto-resolve to Sickw, so the flip is safe *without* waiting for update adoption; (b) Sickw fallback binding live; (c) fixture proves field coverage for that tier; (d) **the reconciliation-cron + status-endpoint path is live and proven** (the guaranteed resolver — the `feedback_url` webhook is only an accelerator, NOT a prerequisite, since its firing is unverified). Test spec: "flag-off → Sickw for migrated, 503 for Petrock-only, no-capability → Sickw for migrated."

### 6. Remediation (check → clean carrier unlock) funnel

**Capture-payment-first / submit-second** — unlocks are $0.06–$225, async (mostly 1–7 days, up to 30). Never `POST /order` until the wallet is debited AND reseller balance confirmed sufficient.

**Trigger (carrier-only).** The offer requires a result that establishes ALL THREE of `blacklistStatus`, `carrier`, and `simLock`. **Only `full` (688) carries all three** — `simLock` (693) checks only `['device','modelNumber','simLock']` (no carrier, no blacklist), so it CANNOT gate the funnel as-is. Rule: if the originating check already has all three, use it; otherwise **house-absorb the missing checks** before constructing an offer — a global blacklist check (1955, $0.019) + a carrier-specific status check (see eligibility gate below). **Never claim "non-blacklisted" without an actual blacklist result.** (If we want `simLock`/693 to gate the funnel, add `carrier` + `blacklistStatus` to `simLock.checksIncluded` + features + parser fixtures + result tests — a shared-package change, not an assumption.) Then: device **non-blacklisted** + **SIM-locked** + **carrier detected** → eligible. Carrier→category: AT&T C210/C209, T-Mobile/Sprint/Metro C159, Claro C215, Mexico C211, Canada/Bell C235, Samsung C304/C239, Oppo/Realme C247, etc. **Blacklisted / lost / stolen / carrier-unknown → NO OFFER.** No iCloud/MDM/FRP/Xiaomi/owner-info paths exist in v1.

**Eligibility gate — explicit ordered chain (any UNKNOWN at any step → suppress).** Carrier unlocks are status-segmented (AT&T "[Clean]"/"[Past Due]"/"[Account-locked]"/"[Wait 30 Days]"…), and **we cannot pick a carrier-specific status checker until we know the carrier** — so carrier detection MUST precede it. House-absorbing (cents) whatever the originating result lacks, in this order:
1. **carrier unknown** → run carrier-detection (693, $0.019) → still unknown → **suppress**;
2. **blacklist unknown** → run global blacklist (1955, $0.019) → blacklisted/lost/stolen → **suppress**;
3. run the **carrier-specific status check** (AT&T 1957 / T-Mobile 746 / Verizon 749 …, $0.037–$0.085) → lost-stolen/unpaid-blocked/no-match → **suppress**; else determine the status segment;
4. route to the **status-matched clean-unlock product** → none → **suppress**; else → **offer**.

All house-absorbed checks run BEFORE the customer pays and are cached on the lookup (a small, deliberate exception to capture-first — these are cents, and they establish the "non-blacklisted + eligible" claim we'd otherwise be asserting without evidence).

**Eligibility catalog:** curated + cron-synced `petrock_remediation_products` (service-role only) with matching metadata (`carrier, region, model_pattern, status_segment, refund_policy, success_rate, turnaround, is_active, manual_disabled`) seeded off `cid` then **validated per-product** — curation MUST exclude null-price rows, "…Refund Request", "NOT … Removal", "…Cleaning/Unbarring/Blacklisted-Supported/Reported-Lost", and no-refund-undisclosed variants. Availability = a table query; zero rows → "no service available".

**State machine:**
`eligibility_pending → eligible | suppressed` → `offer → payment_pending → paid(escrow) → [preflight: GET /account balance ≥ cost && product active && price unchanged] → submitting → submitted → in_progress → completed | failed→refund_pending→refunded`; plus `submission_unknown` (POST-timeout, never auto-refund) and `cancelled`.

**Notification — CRON-PRIMARY, webhook-accelerator.** The reliable completion detector is a **reconciliation cron** (`/api/cron/petrock-reconcile`, age-based backoff: frequent early → hourly, modeled on `lib/vtu-processing-reconciliation.ts`) polling `GET /order` for open orders. The `feedback_url` callback (untrusted; re-fetch `GET /order`; unguessable per-order token; `timingSafeEqual` secret; rate-limited) is a latency optimization only **after** we confirm it fires. On any terminal transition (whichever detector fires first, idempotent) → notify the customer via email + Expo push + in-app "Unlock orders" status. Customer never polls the vendor. On `failed`/`reject` → refund **per the product's `refund_policy`** (some clean unlocks are "No Refund For Denial" — disclose pre-payment, do not promise a refund we can't recover).

**Payment:** wallet debit via a `redeem_wallet_for_remediation`-style RPC BEFORE submit. FX quote-and-lock at offer (store `amount_usd_cost` + `fx_rate_used`); re-validate at `paid→submitting`. Reseller-balance preflight is a hard gate → insufficient ⇒ refund + alert. Needs a funded reseller float + top-up ops process (single unlock can exceed the balance).

**Tables** (RLS on; **customer read via a column-scoped grant/view exposing only `status, timestamps, amount_ngn, refund_policy, turnaround` — NOT `feedback_token`, provider ids, `cost_usd`, or raw inputs**; all writes service-role-only): `petrock_remediation_products`, `petrock_orders` (**raw identifier encrypted-at-rest, purged after terminal** — a real unlock must submit the raw IMEI, so "hash only" does not apply here; carrier unlocks need only the IMEI, no other PII), `petrock_order_events` (append-only audit). RPCs: `redeem_wallet_for_remediation` / `refund_wallet_for_remediation`.

**UX:** inline "Unlock this device" block on the result card (web `imei-results.tsx` / mobile `imei-check-result-view.tsx`), only for non-blacklisted + service-available carrier locks. Shows the detected network+lock ("SIM-locked to AT&T"), the status-matched product, **locked NGN price**, explicit **turnaround** ("usually 1–7 days") with a confirm step, **refund-policy + success-rate line**, "see other options"; wallet payment; "Unlock orders" tracking view. No owner-info/lock-code forms (out of scope).

### 7. Wallet — existing rail + multi-currency later

**The web wallet top-up already exists end-to-end** and credits the same `customer_wallets` ledger the info-check debits: `apps/web/src/app/api/storefront/customer/wallet/top-up/initialize/route.ts` → `payments/webhook/route.ts` `creditWalletTopUp` → `credit_customer_wallet` RPC, plus a "Fund Wallet" panel in `wallet.tsx`. **The only gap** is the checker's insufficient-balance (402) branch showing a copy string (stale comment `imei-checker.tsx:92`) instead of deep-linking to that UI. Phase 1 = that deep-link (do not build a second rail).

**Multi-currency (NGN + USDT)** — separate design pass gating Phase 4. Petrock is USD-priced; Juicyway can receive USDT; a USDT balance removes FX risk on unlocks. Blast radius: NGN-only RPCs, `top-up/initialize` hardcodes `currency:'NGN'`, single-currency `transactions`/wallet schema, no USDT funding intents. Info-checks (NGN) vs unlocks (USD) would read different balances — a ledger/accounting change, not incremental.

---

## Phasing

**Phase 0 — Land the web IMEI rewrite** (`feat/web-imei-device-categories`; Watch + 4 status-field tests added, targeted run 19/19): fetch + **rebase onto current `origin/main`** (the branch drifts behind daily — do not track a fixed count), full verify, commit, push, PR, merge per `docs/web-imei-checker-handover.md`. Petrock branches off `main` after. **No plan change needed for Phase 0.**

**Phase 1 — Deep-link the existing web wallet top-up** into the checker's 402 branch (`imei-checker.tsx:91-111`) → existing `WalletFundingPanel`; remove the stale comment; regression test.

**Phase 2 — Provider abstraction + async pending path + first migrations, shipped dark.** This is the first launchable Petrock phase and **must include the whole pending path** (async is normal, not deferred):
- Create `apps/web/src/lib/imei-providers/**` incl. `tier-bindings.ts` (+ tests); `/api/cron/sync-petrock-catalog/route.ts`; `GET /api/storefront/imei-check/[lookupId]` status endpoint; **`/api/cron/petrock-reconcile/route.ts` — the info-check reconciliation cron (row-leasing + age-based backoff, atomic terminal transitions, idempotent refund/cache writes): the guaranteed resolver when a customer closes the app before the ~42s order finishes** (+ vercel.json entry); migration `imei_provider_products`; append-only migration altering `imei_lookups.status` CHECK (+`provider_submitting`,`pending_provider`,`submission_unknown`) + columns (`provider`,`provider_order_id`,`reference_id`,`feedback_token_hash`,`provider_attempt_started_at`,`cost_usd`) + a Petrock-specific RPC that atomically debits the wallet and transitions the lookup to `provider_submitting` with its submission metadata. The reconciliation cron also promotes stale `provider_submitting` rows → `submission_unknown` + alert (crash-window backstop).
- Modify `env.ts` (`PETROCK_API_BASE_URL`, `PETROCK_API_TOKEN`, `PETROCK_ENABLED` default-false — names match already-provisioned Vercel env; register in `turbo.json` `globalEnv`); `route.ts` (registry dispatch → `202` pending, remove `maxDuration`/in-request poll); `imei-lookup-fulfillment.ts` (generalize); `vercel.json` (cron); delete `sickw-client.ts`.
- **Web + mobile pending UI** (poll status endpoint, resume from `lookupId`) + **mobile `ImeiResultSchema` update** (new optional fields + tolerate pending shape).
- Migrate (each behind the per-tier flip gate, fixture-proven): `blacklist`(1955), `simLock`(693), `knoxGuard`(699), `samsung`(741), `pixel`(721); `full`(688) only if coverage proven. **Device-context-gated (Petrock product is iPhone/iPad-only but the tier spans more categories — migrate only after Phase 2.5, and only for iPhone/iPad traffic):** `icloudPro`(706/712, spans smartphone/laptop), `gsxPremium`(705/704, spans watch).
- **Launch flip:** set BOTH `PETROCK_ENABLED=true` AND `PETROCK_ENABLED_TIERS=<fixture-approved tier keys>` — the allowlist defaults empty, so the global flag alone enables nothing; the allowlist is the actual per-tier flip. New tiers stay out of PUBLIC.

**Phase 2.5 (or within Phase 2) — Device context.** Add optional `device: ImeiDeviceCategory` to `imeiCheckSchema` + both clients (they already track the selected tab via `useImeiDeviceNavigation`); validate against `tier.deviceCategories`; fold into replay identity (absent → legacy). Rule: never bind a multi-device tier to a narrower Petrock product — required before `gsxPremium`/`icloudCleanLost`/`icloudPro` route Mac/Watch traffic to Petrock.

**Phase 3 — New info-check tiers + 6 new result fields (web+mobile) + network-specific carrier checkers + premium.** Fixture test per alias. Includes the feedback-callback capture on our own logged endpoint (proves/disproves the webhook for Phase 4).

**Phase 3.5 — Multi-currency wallet (NGN + USDT)** design + build; gates Phase 4 go-live.

**Phase 4 — Clean carrier-unlock funnel.** Migrations (`petrock_remediation_products`, `petrock_orders`, `petrock_order_events`, redeem/refund RPCs, column-scoped read view); **the categorization curation build (§3b): a product-name parser → structured `model_scope`/`status_segment`/`refund_policy`, a human-reviewed seed dataset, device-normalization off the check result, and an explicit launch carrier set — this is a sized sub-deliverable, not an afterthought**; eligibility+order state machine; capture-first `/api/storefront/imei-remediation/route.ts`; reconciliation cron; feedback route (rate-limited); web+mobile "Unlock this device" UX + "Unlock orders" tracking; 3-channel notifications; `PETROCK_REMEDIATION_ENABLED` default-false. Hard launch gates: categorization curated + vetted for the launch carriers, `submission_unknown` handling proven, per-product `refund_policy`, reseller-float ops, `feedback_url` proven (or cron-only).

---

## Critical files
- `apps/web/src/app/api/storefront/imei-check/route.ts` — dispatch seam → `202` pending.
- `apps/web/src/lib/imei-lookup-fulfillment.ts` — `requestSickwCheck` to generalize.
- `apps/web/src/schemas/imei-check.ts` — add optional `device`.
- `apps/web/src/app/api/storefront/imei-check/sickw-parser*.ts` / `sickw-parser.types.ts` — shared label-map parser; new fields.
- `packages/shared/src/imei/service-tier-apple-devices.ts` / `service-tier-apple.ts` / `service-tiers.ts` — the real tier facts (`icloudCleanLost`=4/$0.03; `icloudPro`=66/$0.22; `gsxPremium`=63/$2.00/₦32,700, spans watch); `PUBLIC_IMEI_SERVICE_TIERS`.
- `apps/mobile-storefront/app/imei-check/index.tsx` (30 s abort, immediate-result requirement) + `lib/validation/commerce-schemas.ts` (`ImeiResultSchema`).
- `apps/web/src/lib/shipping/` (registry precedent); `payments/webhook/route.ts` (`timingSafeEqual`, wallet credit); `vtu-processing-reconciliation.ts` (cron); `20260515142000_imei_lookups_table.sql` (status CHECK + RLS/grant template); `env.ts`.

## Verification
- Per phase: `pnpm turbo lint && pnpm turbo typecheck && pnpm turbo test` for `@baci/web`, `@baci/shared`, **and `@baci/mobile-storefront`** (Phases 2–4 touch mobile); colocated tests per new file (**Vitest for web/shared, Jest for mobile-storefront** — `jest --runInBand`); CodeRabbit review before each PR.
- Provider dispatch: registry fallback to Sickw for all 29 tiers when flag-off; per-tier `202`/pending; flag-off→Sickw (not 503) for migrated; stale-price→503.
- Fixture contract tests: each migrated tier's Petrock product provably covers `checksIncluded`.
- Async: pending→poll→terminal, refresh/app-restart resume, mobile schema accepts pending + new fields.
- POST-timeout: `submission_unknown`, no auto-refund, ops alert.
- **Write-ahead crash safety:** a lookup left in `provider_submitting` (crash between the write-ahead intent and storing `order_uuid`) → replay returns the same `202` and places **no** second `POST /order`; reconciliation promotes stale `provider_submitting` → `submission_unknown` without retry or refund.
- **Atomic debit classification:** failure inside the debit-and-classify RPC commits neither wallet debit nor status transition; a crash immediately after that RPC commits both the debit and `provider_submitting`, never an unclassified charged `pending` row.
- **Old-client gate:** a request WITHOUT the `imei-async-v1` capability resolves migrated tiers to Sickw (synchronous) and never receives a `202 pending`.
- **Preflight-before-debit:** a known-bad config (provider unconfigured / tier not allowlisted / stale-price) returns `503` with no wallet debit.
- Phase 4: state-machine (capture-first, balance preflight, double-refund/double-notify guards, `submission_unknown`, per-product refund_policy); one cheap end-to-end sandbox order; reconciliation-cron for stuck orders.

## Key policies / risks (fail-closed)
- **Clean carrier unlocks only** — no blacklist-removal/bypass/iCloud/MDM/FRP/owner-info. Blacklisted/lost/stolen/carrier-unknown → never offer.
- **Async is normal** — `202` pending + client poll; never hold a request; mobile schema + pending UI ship with the first migrated tier.
- **Flag-off resolves migrated tiers to Sickw** (never 503 a live tier).
- **Capture payment before any `POST /order`**; reseller-balance preflight; FX quote-and-lock; per-product `refund_policy` (incl. clean no-refund variants).
- **POST-timeout → `submission_unknown`, never auto-refund** (hard gate before Phase 4).
- **Webhook body never trusted; cron is the correctness backstop** (webhook unproven).
- **`petrock_orders` customer read is column-scoped** (no tokens/cost/raw inputs); raw identifier encrypted, purged after terminal.
- **Fixture-prove field coverage** before each migration; byte-exact field names (trailing-space test); handle both HTML color formats; status vocab `new/in-process/success/reject`.
- **Balance is operational data** (float + <$25 alert), not a design constant.

---

## Empirical validation (live test orders — 2026-07-09; identifiers redacted)

5 real orders (~$0.19) against live Petrock:
- **Round-trip works.** Test IMEI `3524…0646` → "iPhone 17 Pro Max (A3525), Blacklist: Clean". `POST /order`→`order_uuid` (sync, `data[0][0]`)→`GET /order?order_uuid` poll→`success` in ~42 s.
- **Locked+blacklisted mapping demo.** Test IMEI `3505…5127` (serial `KH34…9530`) via 688 (`full`) + 684 (blacklist): "Locked Carrier: US AT&T · SIMLock: Locked · USA Blacklist: Blocked · FMI: ON · iCloud: Clean". → carrier=AT&T + SIM-locked would route to C210, **but blacklist=Blocked → unlock CTA suppressed** (correct; the only products that unlock it are the excluded laundering variants). Trailing-space field `"IMEI or Serial Number "` accepted verbatim.
- **AT&T Status Check (1957, $0.085)** on the same IMEI → "AT&T ESN: **Lost or Stolen** · Finance: Blacklisted" — richer than generic "Blocked" (gives the reason), and demonstrates the two-step eligibility gate. Status lifecycle `new→in-process→success`.
- **Blacklist-removal is a laundering landmine (excluded):** sold as carrier "Unbarring/Cleaning" with "Convert Blacklisted to Clean" / "Blacklisted IMEIs Supported" / "Reported Lost by insurance to Clean" (AT&T $78–$300, 1–30 days). Not offered.
- **Parser:** two HTML color formats (`<font color=HEX>` + `<span style>`), color = status signal. Rich fields: IMEI2, serial, generation, activation, warranty dates, AppleCare, Locked Carrier, SIMLock, FMI, iCloud, blacklist.
- **Notification:** completion email from `petrock@dhrufusion.com` = account-level (to us), not per-customer; per-order `feedback_url` firing unverified (capture blocked) → cron-primary design.
- **AT&T clean-unlock economics:** $0.06–$225 by status/model; turnaround mostly 1–7 days (34× "1–7 Days", 19× "1–5 Days", 16× "24–72 h") → order-and-wait UX.
