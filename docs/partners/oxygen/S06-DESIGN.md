# S-06 design: checkout/chat interaction shell (v2)

Dated 6 October 2026. Status: v2 amended per pre-coding REJECT (F1–F33);
pending re-review. Parent: S-04 (message table, lookup contract), S-03
(policy), S-05 (route contracts — the per-status matrices below are read from
the real routes), research report. Contract-independent runtime only: no
provider calls, no attempt creation, no loan states/terms, no provider forms,
no persistence beyond a client handoff marker. The initiation 503 stays.

## Shape (unchanged: mixed core + thin renderer)

Framework-agnostic core (`lib/payments/oxygen/`) + thin React renderer/hook
(`components/payments/oxygen/`, `'use client'`, theme tokens). No wiring into
existing checkout/chat files (unwired gate extends). Chat adapter is FUTURE:
the core exposes hygiene builders + intents a later adapter consumes; no chat
components, no chip shape, no transcript insertion point in this slice (F3,
F12). "Checkout/chat" sharing in-slice = the core is surface-agnostic and
proven so by taking only surface-neutral inputs (below).

## Disjoint file set (implementer owns; ALL new, nothing else touched)

- `apps/web/src/lib/payments/oxygen/interaction.ts` + `.test.ts` — machine,
  per-status mapping, marker, hygiene builders (no JSX/React/storage/fetch).
- `apps/web/src/components/payments/oxygen/use-oxygen-interaction.ts` +
  `.test.ts` — async hook (renderHook + deferred injected promises; NO
  `global.fetch` stub — the hook never fetches (F29); generation supersede,
  NOT AbortSignal — injected promises aren't abortable).
- `apps/web/src/components/payments/oxygen/OxygenInteractionPanel.tsx` +
  `.test.tsx` — props-driven panel.

## Machine (core; states final — `interrupted` CUT, see below)

`idle, checking, ready, unavailable, signin-required, initiating, handed-off,
resuming, failed`. NO success/approved state (nothing can succeed while
execution is unavailable — by design). `interrupted` is CUT as a state (F21,
F31): mount-with-marker enters `resuming` directly; "interrupted handoff" =
marker-present flows, and `resuming` copy covers "continue where you left off".

Inputs: `orderId: string | null` (null → `idle`, zero fetch — F1; provenance
table below), `session: { status: loading|authenticated|guest }` (NO userId:
the precedent hook provides none (F2) and server revalidation makes client
user-binding redundant — removed everywhere), injected `lookup`/`submit`,
`notifySessionEvent()` imperative handle for auth flips (F15),
`onSecureFormRequest` REQUIRED callback prop.

Per-surface input provenance (F1, F2):

| Input | Checkout pre-order | Checkout post-order | Chat (future adapter) |
| --- | --- | --- | --- |
| `orderId` | null → shell hidden/`idle` | order context/route | TBD (adapter slice) |
| `session` | three-state hook | three-state hook | three-state hook |
| `lookup`/`submit` | S-05 routes | S-05 routes | S-05 routes |

Handoff requires POST allow — the F4 resolution: `onSecureFormRequest` fires
ONLY on the `initiating → handed-off` transition (2xx). In Phase A the POST
always 503s, so handoff is integration-dormant and covered by unit tests with
a stubbed allow; pin `onSecureFormRequest` never fires on 503. There is NO
direct-handoff action: post-resume "continue" IS submit (POST-first — F5);
display never authorizes (F6: every action invokes `submit` or `lookup`,
never short-circuits on cached state). POST 2xx carries NO payload in this
slice (`{ ok: true }` — attempt IDs are not fabricated; the handoff payload
is client-generated `{ orderId, nonce, issuedAt }` only).

Actions surface (F10): hook exposes `{ onSignin, onRecheck, onSubmit,
onDismiss }` + `onSecureFormRequest` fires once per successful submit
(ref-guarded; pin exact-once across re-renders). Per-state availability:
idle/checking/resuming/initiating: none (initiating shows do-not-close, no
dismiss — verification-view precedent); ready: submit + dismiss; unavailable:
recheck + dismiss; signin-required: signin + dismiss; failed: per-cause
(recheck and/or resubmit) + dismiss; handed-off: dismiss only (explicit
abandon → clears marker, idle). Resubmit allowed only from
failed-with-resubmit (re-invokes submit with current inputs; session drift
fails closed server-side).

## Full transition table (F21; rows exhaustive, one test per row group)

- `idle`: +orderId set → `checking`; +orderId null → `idle` (no fetch);
  +mount with valid marker → `resuming`; +dismiss → `idle`.
- `checking`: lookup 200 available → `ready`; 200 deny → `unavailable`, or
  `signin-required` iff reason is `oxygen_guest_not_allowed` (regardless of
  local session — server's view wins); 200 deny with a missing/unknown
  reason is contract skew and fails closed to `failed{recheck}` (F-crit-1:
  `unavailable` always carries a taxonomy reason); lookup 404 → `idle` + discard
  (hide-on-deny, S-04 listing rule); 401 → `signin-required`, marker KEPT;
  429/5xx/network/CSRF-403 → `failed{recheck}`; 400 → `failed{}` (no
  actions) + `console.error` (host bug — orderId prop malformed); order/
  session change → `checking` (new generation); dismiss → `idle` + clear.
- `ready`: user submit → `initiating`; order/session change → `checking`;
  dismiss → `idle` + clear.
- `unavailable`: recheck → revalidate (marker rule); order/session change →
  `checking`; dismiss → `idle` + clear.
- `signin-required`: signin action → host callback (no transition);
  session→authenticated → revalidate; dismiss → `idle` + clear.
- `initiating`: POST 2xx → `handed-off` (fire once); 403 WITH `code` →
  `unavailable(reason)`; 403 WITHOUT code (CSRF shape) → `failed{resubmit,
  recheck}` (never `unavailable` — F23); 403 with an unknown/empty/
  non-string code likewise fails closed to `failed{resubmit,recheck}`
  (F-crit-1); 404 → `idle` + discard (access
  lost); 401 → `signin-required`, marker KEPT; 429/503/500/network →
  `failed{resubmit,recheck}`; 400 → `failed{}` + `console.error`; order/
  session change → `checking` (abandon; late response ignored — F24a);
  NO dismiss. A throwing `onSecureFormRequest` lands `failed{recheck}`;
  the marker remains, a fixed safe diagnostic is logged, and no rejection
  escapes. No resubmit is offered for this ambiguous accepted submit.
- `handed-off`: terminal in-slice (no auto edges); dismiss → `idle` + clear;
  session event → revalidate (marker rule).
- `resuming`: lookup ok → `ready` + CONSUME marker (F8); deny/signin per
  `checking` rules (marker kept except discards); 404/corrupt/TTL/order-key
  mismatch → `idle` + discard; 401 → `signin-required`, KEPT; 429/5xx/
  network → `failed{recheck→resuming}` (marker kept — F14: transients never
  discard); order/session change → revalidate; dismiss → `idle` + clear.
- `failed`: recheck → revalidate; resubmit → `initiating` (iff offered);
  dismiss → `idle` + clear.
- Global: sign-out (→guest) → `idle` + prefix-clear ALL `baci_oxygen_handoff:`
  keys (F8 — length/key scan); orderId→null → `idle`, markers kept
  (TTL-bounded; documented); mount emits zero `submit` + zero
  `onSecureFormRequest` until explicit action (F13). Revalidate rule
  (uniform): marker for current orderId present → `resuming`, else
  `checking`. Supersede never undoes server effects (documented — F24c).
  Synchronous throws from injected `lookup`/`submit` normalize into their
  rejection paths; a throwing `generateNonce` fails the unstarted attempt
  as a submit network failure — all fail closed with recoveries (F-crit-3).

## Marker (non-authoritative UX hint — F7, F9; userId REMOVED per F2)

`sessionStorage['baci_oxygen_handoff:{orderId}'] = { orderId, createdAt }`
(per-order keys; NO nonce — return correlation needs none since resume always
revalidates + the user re-acts with a fresh intent; NO userId — server
revalidation is the real check). Written BEFORE `onSecureFormRequest` fires.
Consumed on resume-complete (`resuming`→`ready`), dismiss, sign-out
(prefix scan), and discard cases. TTL 24h (idempotency precedent), checked on
read. Corrupt JSON → null → `idle` (credit-direct precedent). Storage
null/throws/quota → flow continues WITHOUT marker (no crash, resume
unavailable this session — F20/F33). Even a well-formed marker ALWAYS
triggers server GET, never skips revalidation (pin). Multi-tab same-order:
last-write-wins, documented + pinned (F16). Double-start: sync in-flight
ref in the hook (place-order precedent) + one nonce per intent; pin one
`submit` call + one nonce on double-click (F24b).

Host constraint (F11): hosts MUST NOT place nonce/`orderId` in URL query
(deep-link path only); explicit, host-owned risk otherwise. Revisit triggers:
handoff/resume model is provisional pending CR-04/CR-13 (embedded-SDK future
replaces marker shape — F25/F27); `Idempotency-Key` binding awaits CR-12 —
tests pin nonce uniqueness/format, never header semantics (F26).

## Hygiene builders (runtime allowlists — F17)

- `toChatMessageText({ status, reason })`: allowlists status ∈ machine states
  and reason ∈ S-03 taxonomy-or-undefined; unknown → fallback copy
  "Something went wrong." (safe misdirection-free generic, never the input).
  Pin: fixture id passed as `status` → fallback (ids unrepresentable).
- `toAnalyticsEvent({ status, reason })`: returns `{ event:
  'oxygen_interaction', properties: { status, reason? } }` matching
  `captureClientEvent(event, properties)` (verified signature — F18);
  statuses enumerated (= machine states); unknown → `null` (host skips —
  analytics never emits garbage). Sweep: no fixture ids/emails/free text.
- Shell never calls analytics/fetch/storage singletons itself.

## Renderer (thin)

Props `{ state, reason?, onAction }`; spinner for checking/resuming/
initiating ("do not close" only while initiating); S-04 messages VERBATIM
(pinned against literals copied from the S-04 table — specified API, same
treatment as reason codes — F30); action buttons per state table; empty/
hidden on `idle`; `role="status"` container (implicit polite live region —
no new aria pattern invented — F31); `checkoutStyles`/`store-primary`
tokens, `PaymentOptionCard`-compatible shape; no fetch/router/storage
(static test). D-05 sweep: forbidden phrases
(approved/approval/eligible/eligibility/qualify/qualified/pre-approved/
"approved for") over panel copy + builder outputs (F30).

## Hook (async glue)

`use-oxygen-interaction({ orderId, session, lookup, submit, storage?,
now?, generateNonce?, onSecureFormRequest })`: lookup-on-resolve (waits out
`loading` and idles on revalidation); unmount/input cleanup invalidates
pending generations; hosts must call `notifySessionEvent` on identity changes
that preserve status. No manual memoization; effect-triggered lookup uses
React `useEffectEvent` with explicit order/status dependencies. Generation-guarded transitions (observables tested, never
counter values — F32); in-flight submit guard; marker ops; resume-on-mount
(GET-only — POST spy assertion); `notifySessionEvent()` → guest? idle+clear
: revalidate; sign-out → prefix-clear. `storage` default: sessionStorage
when available else null-behavior. `now` default Date.now. `generateNonce`
default `crypto.randomUUID` — NO fallback: engines Node 24 + browserslist
(last 2 Chrome/FF/Safari/Edge) guarantee it (verified — F33).

## Non-negotiable rules (unchanged + F6/F32 restatements)

Server authority (display never authorizes; POST revalidates; client GET
uncached — official fetch semantics); D-05 (availability ≠ eligibility);
503 preserved (allow unreachable at integration; handoff dormant); sensitive
data out of chat/analytics/marker/URLs; wiring gate extends (static test +
grep: new files imported only by their tests). Generation tests assert
observables; theme pin = token-presence + no-hex sweep on rendered output
(requirement-pin, acknowledged F32).

## Recommended product choices (unchanged from v1)

Guest initiation stays denied; installments-tab Oxygen card reusing
`PaymentOptionCard`; same-tab navigation with marker (not popup); chat offers
a deep-link chip into checkout, no in-chat initiation until transcript
hygiene is audited end-to-end; single-item/no-split until CR-06/10. All stay
open decisions.

## Acceptance criteria (repaired per F29–F33)

- Behavioural RED per file (stub failing assertions), minimal GREEN, refactor.
- Core: full transition table (every row above incl. 404/401/400/CSRF-403
  mappings, dismiss/none-offered states, terminal handed-off); stale-
  generation observable drops; marker consume/discard/TTL/corrupt/multi-tab/
  prefix-clear/storage-null behaviors; nonce uniqueness/format (never header
  semantics); reason→copy/action for six reasons + 503/429/network/401;
  chat/analytics allowlist fallbacks + sweeps; S-04-verbatim + D-05 sweeps;
  no-import static test (no React/provider/storage/fetch).
- Hook: lookup-on-resolve; session-flip recompute; sign-out reset + clear;
  notifySessionEvent paths; in-flight repeat ignored; single nonce per
  intent; resume GET-only (POST + handoff spies silent until explicit
  action); order-change-mid-POST exits initiating; fire-once handoff.
- Panel: roles/text/callbacks per state incl. no-action states; loading/
  disabled; role=status; token-presence + no-hex; no fetch/router/storage
  imports.
- `biome check`, owned vitest, `turbo lint typecheck --filter=@baci/web`,
  CodeRabbit, extended unwired gate; exact commands/counts reported; docs
  untouched by implementer.
- S-05 review re-check before implementation: rescan for landed findings;
  valid findings fixed (TDD) before shell runtime work.

## Out of scope (V2 additions: chat adapter + chip shape, nonce echo channel,
abandon auto-detection, attempt IDs, 2xx payload use, provider forms/fields,
attempt creation/persistence, projection field, UI wiring, analytics calls,
translations, secure-form target route, migrations, env vars, provider
calls). Pending S-05 review findings take precedence over shell runtime work.
