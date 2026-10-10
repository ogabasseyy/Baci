# Primary mobile card funding connection

The primary merchant's existing wallet/card action now branches in
`wallet-screen.handlers.ts` to `fund-primary-wallet-card.ts`. Other merchants
retain generic wallet top-up initialization and confirmation. The hosted
staging card-funding prohibition remains unchanged; no runtime flag, provider
capability, credential, backend route, webhook or migration is activated here.

The actual native confirmation dialog obtains explicit consent for the displayed
one-time amount. This version does not offer card saving: `saveCard=false` is
disclosed and transmitted with `oneTimeCharge=true` and
`version=primary-wallet-card-v1`. No BVN, fabricated savings goal, customer ID,
provider destination ID or arbitrary metadata is sent.

`createPrimaryWalletCardFundingClient` uses the existing authenticated storefront
API client with CSRF. It persists the immutable amount/choice and random
idempotency key in fail-closed AsyncStorage before POST to
`/api/storefront/customer/wallet/primary-card/initialize`. Records are scoped by
merchant and authenticated user; the current Supabase user must still match
before a request. Concurrent client instances share a serialization queue.
Each request constructs a fresh authenticated transport after that check, so
the long-lived funding client cannot reuse the preceding account's cached bearer.
The completion UI rechecks its account before refresh/success and delayed return.

The backend assigns an operation ID and reference. Once known, restart/retry
recovery uses only POST `/api/storefront/customer/wallet/primary-card/status`.
If initialization timed out before its response, the original immutable
initialization request/key is replayed; backend single-dispatch fencing is still
required. A new key is never manufactured for an unresolved operation.

Known checkout sessions open the shared payment gateway as
`paymentKind=primary_wallet_card`. Redirect/message callbacks invoke primary
status confirmation, never generic wallet confirmation or order completion.
Retry checks status rather than reloading checkout to request another charge.
Noncompleted authoritative responses show the existing `pending` UI state,
with a wallet-specific status view rather than an order or failed-charge screen.
A status/network error is distinct: it says the status could not be checked,
not that the charge failed. Both views offer only a status check and return to
wallet, warn against paying again, and retain the durable operation.
The callback reference must exactly match the durable, server-returned operation.
Checkout acceptance, successful collection, pending custody and reconciliation
requirements are not wallet credit. Only authoritative `completed` status removes
the operation and permits wallet-query refresh/safe return navigation. Cancellation,
timeout, account switching, malformed storage and provider/configuration errors
retain the record. A pending operation is recovered from the existing wallet
fund action after process death; it is not silently replaced with a new amount.
Completed recovery from that action resumes the stored sanitized savings return
destination, including the selected goal and amount. It does not automatically
move wallet money into savings; the separate owned-goal transfer remains explicit.

Local Jest evidence is mocked and does not prove provider charge acceptance,
custody settlement, webhook delivery or availability of deployed restricted
capabilities. Backend/card owners must verify those independently before an
authorized end-to-end financial test. Card saving/reuse UI is outside this slice.

## Reinstall / second-device recovery

Every primary launch — stamped or stampless — mounts its checkout WebView
only when this device's persisted record proves the signed-in user owns the
URL reference. After a reinstall, cleared storage, or on a second device,
that record is absent, so the launch fails closed to a blocked view that
names the wallet return and states a completed checkout will still be found
and credited. No funds are lost: the server still holds the operation, and
the completion path re-validates server-side via `recover()`.

Recovery for the owner:

1. Return to the wallet on the original device if it still holds the
   record — the pending funding resumes from the fund action.
2. Otherwise start a new funding from the wallet on the current device.
   One pending operation per merchant/user is enforced, and the server
   binds completion to the operation that was actually charged, so the
   new attempt cannot double-charge the old checkout.
3. If the old checkout was completed (charged) before the device was
   lost, its funds settle through the normal custody path and appear
   after a wallet refresh — no re-entry of card details is needed.

Deliberately not built: a server-backed mount-time ownership lookup.
It would trade the offline fail-closed guarantee for availability in a
case the blocked copy plus server-side recovery already covers. Revisit
only with explicit product approval and a dedicated abuse analysis (the
lookup input is caller-controlled deep-link params).

## Phone acceptance checklist (not executed)

The earlier production primary-route 404 observation is a reported deployment
gate, not a fresh probe or evidence of completion. Do not test payments against
production or toggle capabilities to bypass it. An owner must first authorize
the release/environment and any sandbox financial exercise. Use an approved test
build, exact merchant and authenticated test customer with a verified primary
intent. Restricted-role readiness, origin binding, route availability and backend
card/webhook reconciliation must be approved independently. A 404 or NOT_READY
response blocks checkout; no alternate legacy endpoint is an acceptable fallback.

1. Open Wallet and enter a permitted test amount. Confirm that Cancel creates
   no operation/request; authorization states one-time charge and no saved card.
   A record must be durable before initialize is dispatched. Check only booleans
   and endpoint/method counts, never inspect raw storage or credentials.
2. Authorize once in the approved sandbox. A checkout callback alone must show
   funding pending, not success, credit or an order. Check funding status must
   issue only POST `primary-card/status` for the saved operation, with zero new
   initialize requests or checkout reloads. Repeated taps must not dispatch charges.
3. Disable network during status confirmation. Expect "Could not check funding
   status", the do-not-pay-again warning and a retained-operation boolean. Restore
   network and press Check funding status: the same operation is checked; no new
   idempotency key or charge is created. Pending/review remains pending.
4. Kill/reopen the app with a known operation pending. The wallet funding action
   recovers its status rather than accepting a new amount/choice. For a timeout
   before an operation ID was received, only the same immutable initialization
   key/body may replay under backend single-dispatch fencing; never create a new key.
5. Start as test account A, sign out, then sign in as B. B must not recover A's
   operation or see A's completion/savings handoff. Sign back in as A and check
   the retained operation. Repeat switching while status is in flight: no stale
   success or delayed navigation should be presented to B.
6. From an actual selected manual savings goal with insufficient wallet funds,
   use the existing wallet top-up action. Goal/amount remain in the stored internal
   return destination, not a fabricated card API goal. Only authoritative completed
   status clears the operation, refreshes wallet and resumes that savings selection.
   Pending must not contribute to savings. A savings transfer still needs its own
   explicit action and authoritative confirmation. Repeat completion after restart.
7. Check a nonprimary merchant: legacy initialization/confirmation stays unchanged.
   Confirm primary close/success copy refers to wallet recovery, never an order.

### Safe evidence to record

Record build/artifact identifier, selected environment/origin, test-case label,
endpoint suffix/method, HTTP status, allowlisted operation state, request counts,
same-operation/same-key comparison booleans, record-retained boolean and rendered
screen title. Record completion only if the backend independently confirms it.
Never export Authorization/CSRF headers, full checkout URLs/references, raw request
or provider response bodies, AsyncStorage records, user/goal/account identifiers,
BVN, card details, cookies or credentials. Use a local comparison to obtain boolean
correlation evidence rather than logging the identifiers. No device test, remote
route probe, provider mutation or deployment was performed for this checklist.
